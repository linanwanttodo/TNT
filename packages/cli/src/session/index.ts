import fs from "fs";
import os from "os";
import path from "path";

import type {
  BaseSessionMetadata,
  ChatHistoryItem,
  Session,
  SessionUsage,
  Usage,
} from "core/index.js";
import historyManager from "core/util/history.js";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_SESSION_TITLE } from "../constants/session.js";
import { delegationDepthOf } from "../subagent/depth.js";
import { logger } from "../utils/logger.js";

// Re-export BaseSessionMetadata for external consumers
export type { BaseSessionMetadata };

// Extended type for sessions that can be local or remote
export interface ExtendedSessionMetadata extends BaseSessionMetadata {
  firstUserMessage?: string;
  isRemote?: boolean;
  remoteId?: string; // For remote sessions, this is the agent ID
  parentSessionId?: string;
  subagentType?: string;
}

// Note: We now use UUID-based session IDs instead of terminal-based IDs.
// Each new chat session gets a unique UUID.
// The --resume flag loads the most recent session.

/**
 * Get the session storage directory
 */
function getSessionDir(): string {
  // For tests, use the test directory if we're in test mode
  if (process.env.CONTINUE_CLI_TEST && process.env.HOME) {
    const sessionDir = path.join(process.env.HOME, ".tnt", "sessions");

    // Create directory if it doesn't exist
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    return sessionDir;
  }

  // Use CONTINUE_GLOBAL_DIR if set (for testing)
  const continueHome =
    process.env.CONTINUE_GLOBAL_DIR || path.join(os.homedir(), ".tnt");
  const sessionDir = path.join(continueHome, "sessions");

  // Create directory if it doesn't exist
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  return sessionDir;
}

/**
 * Get the session file path for the current session
 */
export function getSessionFilePath(): string {
  const sessionId = getCurrentSessionId();
  const sessionDir = getSessionDir();
  return path.join(sessionDir, `${sessionId}.json`);
}

// Singleton for current session management
class SessionManager {
  private static instance: SessionManager;
  private currentSession: Session | null = null;
  private historyGeneration = 0;
  /**
   * True once the first request whose prefix belongs to this session has been
   * counted. Compaction and title generation do not set it, because their
   * requests carry prefixes of their own.
   */
  private hasRecordedTurnUsage = false;
  private sessionUsage: SessionUsage = {
    totalCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    promptTokensDetails: {
      cachedTokens: 0,
      cacheWriteTokens: 0,
    },
  };

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  getCurrentSession(): Session {
    if (!this.currentSession) {
      // Use test session ID for testing consistency
      const sessionId = process.env.CONTINUE_CLI_TEST_SESSION_ID
        ? process.env.CONTINUE_CLI_TEST_SESSION_ID
        : uuidv4();

      this.currentSession = {
        sessionId,
        title: DEFAULT_SESSION_TITLE,
        workspaceDirectory: process.cwd(),
        history: [],
        usage: { ...this.sessionUsage },
      };
    }
    return this.currentSession;
  }

  setSession(session: Session): void {
    this.currentSession = session;
    this.historyGeneration++;
    this.syncUsageFromSession();
  }

  updateHistory(history: ChatHistoryItem[]): void {
    const session = this.getCurrentSession();
    session.history = history;
    this.historyGeneration++;
    saveSession();
  }

  getHistoryGeneration(): number {
    return this.historyGeneration;
  }

  replaceHistoryIfGeneration(
    expectedGeneration: number,
    history: ChatHistoryItem[],
  ): boolean {
    if (this.historyGeneration !== expectedGeneration) {
      return false;
    }
    this.updateHistory(history);
    return true;
  }

  updateTitle(title: string): void {
    const session = this.getCurrentSession();
    session.title = title;
    saveSession();
  }

  clear(): void {
    this.currentSession = null;
    this.historyGeneration++;
    this.hasRecordedTurnUsage = false;
    this.sessionUsage = {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  hasSession(): boolean {
    return this.currentSession !== null;
  }

  getSessionId(): string {
    return this.getCurrentSession().sessionId;
  }

  trackUsage(
    cost: number,
    usage: Usage,
    kind: "turn" | "compaction" = "turn",
  ): void {
    // Accumulate cost
    this.sessionUsage.totalCost += cost;

    // Accumulate token counts
    this.sessionUsage.promptTokens += usage.promptTokens;
    this.sessionUsage.completionTokens += usage.completionTokens;

    // Accumulate cache tokens if present
    if (usage.promptTokensDetails?.cachedTokens) {
      this.sessionUsage.promptTokensDetails =
        this.sessionUsage.promptTokensDetails || {};
      this.sessionUsage.promptTokensDetails.cachedTokens =
        (this.sessionUsage.promptTokensDetails.cachedTokens || 0) +
        usage.promptTokensDetails.cachedTokens;
    }

    if (usage.promptTokensDetails?.cacheWriteTokens) {
      this.sessionUsage.promptTokensDetails =
        this.sessionUsage.promptTokensDetails || {};
      this.sessionUsage.promptTokensDetails.cacheWriteTokens =
        (this.sessionUsage.promptTokensDetails.cacheWriteTokens || 0) +
        usage.promptTokensDetails.cacheWriteTokens;
    }

    if (kind === "compaction") {
      this.recordCompactionUsage(cost, usage);
    }

    if (kind === "turn" && !this.hasRecordedTurnUsage) {
      this.hasRecordedTurnUsage = true;
      this.sessionUsage.coldStart = {
        inputTokens: usage.promptTokens,
        cachedTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
        cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
      };
      // Logged at info because this is the number a user can act on. The
      // session totals below only ever grow and cannot explain a slow start.
      logger.info("Session cache cold start", {
        ...this.sessionUsage.coldStart,
        cost,
      });
    }

    // Update session and persist
    const session = this.getCurrentSession();
    session.usage = { ...this.sessionUsage };
    saveSession(); // Persist immediately
  }

  /**
   * Compaction carries a prefix of its own, so its tokens are reported apart
   * from the session totals and together with the cache read they produced.
   * Only those two numbers side by side say whether the shrinking paid for
   * itself.
   */
  private recordCompactionUsage(cost: number, usage: Usage): void {
    const cachedTokens = usage.promptTokensDetails?.cachedTokens ?? 0;
    const cacheWriteTokens = usage.promptTokensDetails?.cacheWriteTokens ?? 0;
    const previous = this.sessionUsage.compaction ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    };
    const compaction: NonNullable<SessionUsage["compaction"]> = {
      requests: previous.requests + 1,
      inputTokens: previous.inputTokens + usage.promptTokens,
      outputTokens: previous.outputTokens + usage.completionTokens,
      cachedTokens: previous.cachedTokens + cachedTokens,
      cacheWriteTokens: previous.cacheWriteTokens + cacheWriteTokens,
      cost: previous.cost + cost,
    };

    this.sessionUsage.compaction = compaction;

    // Logged at info so the trade-off is visible without a debug level set.
    logger.info("Compaction usage", {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      cacheReadTokens: cachedTokens,
      cacheWriteTokens,
      cacheHitRatio:
        usage.promptTokens > 0
          ? Number((cachedTokens / usage.promptTokens).toFixed(4))
          : 0,
      cost,
      requests: compaction.requests,
      costSoFar: compaction.cost,
      inputTokensSoFar: compaction.inputTokens,
    });
  }

  getTotalCost(): number {
    return this.sessionUsage.totalCost;
  }

  getUsage(): SessionUsage {
    return { ...this.sessionUsage };
  }

  private syncUsageFromSession(): void {
    const session = this.currentSession;
    if (session?.usage) {
      this.sessionUsage = { ...session.usage };
      // A session that already recorded a cold start keeps that number. One
      // loaded from an older format has none, and the first request after a
      // resume is exactly the slow start worth attributing.
      this.hasRecordedTurnUsage = Boolean(session.usage.coldStart);
    } else {
      // Migrate old sessions that only had totalCost
      this.sessionUsage = {
        totalCost: 0,
        promptTokens: 0,
        completionTokens: 0,
        promptTokensDetails: {
          cachedTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    }
  }
}

function getCurrentSessionId(): string {
  return SessionManager.getInstance().getSessionId();
}

function modifySessionBeforeSave(session: Session): Session {
  const filteredHistory = session.history.filter((item) => {
    return item.message.role !== "system";
  });

  const modifiedHistory = filteredHistory.map((item) => {
    if (item.message.role === "user") {
      return {
        ...item,
        editorState: item.message.content,
      };
    }

    return item;
  });

  return {
    ...session,
    history: modifiedHistory,
  };
}

export function getSessionPersistenceSnapshot(session: Session): Session {
  return modifySessionBeforeSave(session);
}

/**
 * Get the complete state snapshot that matches the /state endpoint format
 */
export interface StateSnapshot {
  session: Session;
  isProcessing: boolean;
  messageQueueLength: number;
  pendingPermission: any;
}

export function getCompleteStateSnapshot(
  session: Session,
  isProcessing: boolean = false,
  messageQueueLength: number = 0,
  pendingPermission: any = null,
): StateSnapshot {
  return {
    session: getSessionPersistenceSnapshot(session),
    isProcessing,
    messageQueueLength,
    pendingPermission,
  };
}

/**
 * Check if a session has meaningful content for saving
 */
function hasSessionContent(session: Session): boolean {
  if (!session.history || session.history.length === 0) {
    return false;
  }

  const nonSystemMessages = session.history.filter(
    (item) => item.message.role !== "system",
  );

  return nonSystemMessages.length > 0;
}

/**
 * Save the current session to file
 */
export function saveSession(): void {
  try {
    const manager = SessionManager.getInstance();
    if (!manager.hasSession()) {
      return;
    }

    const session = manager.getCurrentSession();
    if (!hasSessionContent(session)) {
      return;
    }

    const sessionToSave = getSessionPersistenceSnapshot(session);
    historyManager.save(sessionToSave);
  } catch (error) {
    logger.error("Error saving session:", error);
  }
}

/**
 * Load session from current terminal's session file
 */
export function loadSession(): Session | null {
  try {
    // For resume, we need to find the most recent session
    const sessionDir = getSessionDir();
    if (!fs.existsSync(sessionDir)) {
      return null;
    }

    const files = fs
      .readdirSync(sessionDir)
      .filter((f) => f.endsWith(".json") && f !== "sessions.json")
      .map((f) => ({
        name: f,
        path: path.join(sessionDir, f),
        mtime: fs.statSync(path.join(sessionDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length === 0) {
      return null;
    }

    // Load the most recent session
    const session: Session = JSON.parse(fs.readFileSync(files[0].path, "utf8"));
    // Set this as the current session for future saves
    SessionManager.getInstance().setSession(session);
    return session;
  } catch (error) {
    logger.error("Error loading session:", error);
    return null;
  }
}

/**
 * Create a new session
 */
export function createSession(
  history: ChatHistoryItem[] = [],
  sessionId?: string,
): Session {
  const session: Session = {
    sessionId: sessionId ?? uuidv4(),
    title: DEFAULT_SESSION_TITLE,
    workspaceDirectory: process.cwd(),
    history,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  };
  SessionManager.getInstance().setSession(session);
  return session;
}

/**
 * Clear the current session
 */
export function clearSession(): void {
  try {
    const manager = SessionManager.getInstance();
    if (manager.hasSession()) {
      const sessionFilePath = path.join(
        getSessionDir(),
        `${manager.getSessionId()}.json`,
      );
      if (fs.existsSync(sessionFilePath)) {
        fs.unlinkSync(sessionFilePath);
      }
      manager.clear();
    }
  } catch (error) {
    logger.error("Error clearing session:", error);
  }
}

/**
 * Check if a session exists for the current terminal
 */
export function hasSession(): boolean {
  const manager = SessionManager.getInstance();
  if (!manager.hasSession()) {
    return false;
  }
  const sessionFilePath = path.join(
    getSessionDir(),
    `${manager.getSessionId()}.json`,
  );
  return fs.existsSync(sessionFilePath);
}

/**
 * Get metadata from a session file with first user message preview
 */
function getSessionMetadataWithPreview(
  filePath: string,
): ExtendedSessionMetadata | null {
  try {
    const sessionData: Session = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const stats = fs.statSync(filePath);

    // Find the first user message for preview
    let firstUserMessage: string | undefined;
    for (const item of sessionData.history || []) {
      if (item.message.role === "user") {
        const content = item.message.content;
        // Handle both string and array content types
        if (typeof content === "string") {
          firstUserMessage = content;
        } else if (Array.isArray(content)) {
          // For array content, find the first text part
          const textPart = content.find((part) => part.type === "text");
          firstUserMessage =
            textPart && "text" in textPart
              ? textPart.text
              : "(multimodal message)";
        } else {
          firstUserMessage = "(unknown content type)";
        }
        break;
      }
    }

    return {
      sessionId: sessionData.sessionId,
      title: sessionData.title || DEFAULT_SESSION_TITLE,
      dateCreated: stats.birthtime.toISOString(),
      workspaceDirectory: sessionData.workspaceDirectory || "",
      firstUserMessage,
      parentSessionId: sessionData.parentSessionId,
      subagentType: sessionData.subagentType,
    };
  } catch (error) {
    logger.error(`Error reading session file ${filePath}:`, error);
    return null;
  }
}

/**
 * Remote sessions are no longer available (Hub integration removed).
 */
export async function getRemoteSessions(): Promise<ExtendedSessionMetadata[]> {
  return [];
}

/**
 * List all available sessions with metadata (both local and remote)
 */
export async function listSessions(
  limit: number = 100,
): Promise<ExtendedSessionMetadata[]> {
  try {
    // Get local sessions
    const localSessions = historyManager.list({ limit });

    // Add first user message preview to each local session
    const localSessionsWithPreview: ExtendedSessionMetadata[] = [];

    for (const sessionMeta of localSessions) {
      const sessionFilePath = path.join(
        getSessionDir(),
        `${sessionMeta.sessionId}.json`,
      );

      if (fs.existsSync(sessionFilePath)) {
        const metadata = getSessionMetadataWithPreview(sessionFilePath);
        // A delegated run is reachable from its parent, so it is kept out of
        // the root list to avoid mixing transcripts of different scopes.
        if (metadata && metadata.parentSessionId) {
          continue;
        }
        if (metadata) {
          localSessionsWithPreview.push({
            ...metadata,
            isRemote: false,
          });
        }
      } else {
        // Fall back to basic metadata if file doesn't exist
        localSessionsWithPreview.push({
          ...sessionMeta,
          isRemote: false,
        });
      }
    }

    // Get remote sessions
    const remoteSessions = await getRemoteSessions();

    // Combine and sort by date (most recent first)
    const allSessions = [...localSessionsWithPreview, ...remoteSessions]
      .sort(
        (a, b) =>
          new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
      )
      .slice(0, limit);

    return allSessions;
  } catch (error) {
    logger.error("Error listing sessions:", error);
    return [];
  }
}

/**
 * Load session by ID
 */
export function loadSessionById(sessionId: string): Session | null {
  try {
    const session = historyManager.load(sessionId);
    return session;
  } catch (error) {
    logger.error("Error loading session by ID:", error);
    return null;
  }
}

/**
 * Load an existing session by ID or create a new one with that ID.
 * Useful for long-lived processes (e.g., tnt serve) that need to
 * preserve chat history across restarts for the same storage/agent id.
 */
export function loadOrCreateSessionById(
  sessionId: string,
  history: ChatHistoryItem[] = [],
): Session {
  const existing = loadSessionById(sessionId);
  if (existing) {
    SessionManager.getInstance().setSession(existing);
    return existing;
  }

  return createSession(history, sessionId);
}

/**
 * Update the current session's history
 */
export function updateSessionHistory(history: ChatHistoryItem[]): void {
  SessionManager.getInstance().updateHistory(history);
}

export function getSessionHistoryGeneration(): number {
  return SessionManager.getInstance().getHistoryGeneration();
}

export function replaceSessionHistoryIfGeneration(
  expectedGeneration: number,
  history: ChatHistoryItem[],
): boolean {
  return SessionManager.getInstance().replaceHistoryIfGeneration(
    expectedGeneration,
    history,
  );
}

/**
 * Update the current session's title
 */
export function updateSessionTitle(title: string): void {
  SessionManager.getInstance().updateTitle(title);
}

/**
 * Session-wide goal shown above the composer. It rides along with the session
 * so a resumed conversation keeps working toward the same objective.
 */
export function getSessionGoal(): string | undefined {
  const goal = SessionManager.getInstance().getCurrentSession().goal;
  return goal?.trim() || undefined;
}

export function setSessionGoal(goal: string | undefined): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  const normalized = goal?.trim();
  if (normalized) {
    session.goal = normalized;
  } else {
    delete session.goal;
  }
  manager.updateHistory(session.history);
}

/**
 * Persist a delegated run as its own session so it can be inspected later.
 *
 * The child is linked back to the session that spawned it and marked
 * delegated, which keeps it out of the root session list while leaving it
 * reachable through the parent.
 */
export function saveSubagentSession(options: {
  parentSessionId: string;
  subagentType: string;
  history: ChatHistoryItem[];
}): Session {
  const { parentSessionId, subagentType, history } = options;
  const child: Session = {
    sessionId: `${parentSessionId}:${uuidv4().slice(0, 8)}`,
    title: `${subagentType} session`,
    workspaceDirectory: process.cwd(),
    history,
    parentSessionId,
    subagentType,
    delegationDepth:
      delegationDepthOf({
        delegationDepth: getCurrentSession().delegationDepth,
      }) + 1,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  };

  historyManager.save(getSessionPersistenceSnapshot(child));
  return child;
}

/**
 * Sessions spawned by a delegated run, newest first. Used by the parent to
 * offer navigation into the subagent transcripts.
 */
export function listSubagentSessions(
  parentSessionId: string,
): ExtendedSessionMetadata[] {
  try {
    const sessionDir = getSessionDir();
    if (!fs.existsSync(sessionDir)) {
      return [];
    }

    return fs
      .readdirSync(sessionDir)
      .filter((file) => file.endsWith(".json") && file !== "sessions.json")
      .map((file): ExtendedSessionMetadata | null => {
        try {
          const session: Session = JSON.parse(
            fs.readFileSync(path.join(sessionDir, file), "utf8"),
          );
          if (session.parentSessionId !== parentSessionId) {
            return null;
          }
          const metadata = getSessionMetadataWithPreview(
            path.join(sessionDir, file),
          );
          return metadata ? { ...metadata, isRemote: false } : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ExtendedSessionMetadata => entry !== null)
      .sort(
        (a, b) =>
          new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
      );
  } catch (error) {
    logger.error("Error listing subagent sessions:", error);
    return [];
  }
}

/**
 * Get the current session
 */
export function getCurrentSession(): Session {
  return SessionManager.getInstance().getCurrentSession();
}

/**
 * Start a new session with a new sessionId
 */
export function startNewSession(history: ChatHistoryItem[] = []): Session {
  const manager = SessionManager.getInstance();

  // Clear the current session from memory (don't delete the file)
  manager.clear();

  // Create a new session with a new sessionId
  const newSession: Session = {
    sessionId: uuidv4(),
    title: DEFAULT_SESSION_TITLE,
    workspaceDirectory: process.cwd(),
    history,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  };

  manager.setSession(newSession);
  return newSession;
}

/**
 * Track cost for the current session
 */
export function trackSessionUsage(
  cost: number,
  usage: Usage,
  kind: "turn" | "compaction" = "turn",
): void {
  SessionManager.getInstance().trackUsage(cost, usage, kind);
}

/**
 * Get the total cost for the current session
 */
export function getTotalSessionCost(): number {
  return SessionManager.getInstance().getTotalCost();
}

/**
 * Get the full usage statistics for the current session
 */
export function getSessionUsage(): SessionUsage {
  return SessionManager.getInstance().getUsage();
}
