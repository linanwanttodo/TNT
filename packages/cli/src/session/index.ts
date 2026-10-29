import fs from "fs";

import type {
  BaseSessionMetadata,
  ChatHistoryItem,
  Session,
  SessionUsage,
  Usage,
} from "core/index.js";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
import { delegationDepthOf } from "../subagent/depth.js";
import { logger } from "../utils/logger.js";

import { historyAdapter } from "./historyAdapter.js";
import {
  assertSessionId,
  ensureSessionScopedDir,
  getLegacySessionPath,
  getTranscriptPath,
} from "./paths.js";
import { sessionStore, type SessionSource } from "./store.js";

// Re-export BaseSessionMetadata for external consumers
export type { BaseSessionMetadata };

// Extended type for sessions that can be local or remote
export interface ExtendedSessionMetadata extends BaseSessionMetadata {
  firstUserMessage?: string;
  isRemote?: boolean;
  remoteId?: string; // For remote sessions, this is the agent ID
  parentSessionId?: string;
  subagentType?: string;
  updatedAt?: string;
  source?: SessionSource;
}

/**
 * The session this process currently owns. Keeping it beside the session
 * manager means a resume in another terminal cannot silently write the same
 * transcript.
 */
let activeLeaseId: string | null = null;

function releaseActiveLease(): void {
  if (activeLeaseId === null) return;
  sessionStore.releaseLease(activeLeaseId);
  activeLeaseId = null;
}

function acquireActiveLease(sessionId: string): void {
  if (activeLeaseId === sessionId) return;
  sessionStore.acquireLease(sessionId);
  if (activeLeaseId !== null) sessionStore.releaseLease(activeLeaseId);
  activeLeaseId = sessionId;
}

// Note: We now use UUID-based session IDs instead of terminal-based IDs.
// Each new chat session gets a unique UUID.
// The --resume flag loads the most recent session.

/**
 * Get the session file path for the current session.
 *
 * The v2 transcript is the live file; a legacy flat JSON session that has not
 * been migrated yet is still the file hooks should see.
 */
export function getSessionFilePath(): string {
  const sessionId = getCurrentSessionId();
  const transcript = getTranscriptPath(sessionId);
  if (fs.existsSync(transcript)) return transcript;
  const legacy = getLegacySessionPath(sessionId);
  if (fs.existsSync(legacy)) return legacy;
  return transcript;
}

/**
 * Where a tool result too large to hand the model whole is kept: inside the
 * session's own directory, so deleting the session removes its sidecars too.
 */
export function getToolResultsDir(sessionId: string): string {
  return ensureSessionScopedDir("tool-results", sessionId);
}

/**
 * Where the prefix that moved between two rounds is written, beside the
 * transcript: a cache break that only exists as a log line with a field name
 * cannot be read.
 */
export function getCacheBreaksDir(sessionId: string): string {
  return ensureSessionScopedDir("cache-breaks", sessionId);
}

/**
 * Where the lines of a transcript block that the terminal could not show are
 * kept, so the notice printed in its place names a file that exists.
 */
export function getBlockOverflowDir(sessionId: string): string {
  return ensureSessionScopedDir("block-overflow", sessionId);
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
      const sessionId = process.env.TNT_TEST_SESSION_ID
        ? process.env.TNT_TEST_SESSION_ID
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
    /**
     * True when the model has no price in the table. The request contributes
     * nothing to the total, and the counter says why the total is short.
     */
    unpriced: boolean = false,
  ): void {
    // Accumulate cost
    this.sessionUsage.totalCost += cost;
    if (unpriced) {
      this.sessionUsage.unpricedRequests =
        (this.sessionUsage.unpricedRequests ?? 0) + 1;
    }
    // A round that reported no prompt tokens contributed nothing to the sums
    // below, so the ratio made from them is not a full account of the session.
    // Both sides are counted because the reader needs the fraction, not just
    // the shortfall.
    if (usage.promptTokens <= 0) {
      this.sessionUsage.unreportedUsageRequests =
        (this.sessionUsage.unreportedUsageRequests ?? 0) + 1;
    } else {
      this.sessionUsage.reportedUsageRequests =
        (this.sessionUsage.reportedUsageRequests ?? 0) + 1;
    }

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
   * Records a request whose usage never arrived. The round ended before the
   * provider's final chunk, so there are no tokens to add - but the request
   * happened and was billed, and a session total that silently omits it is the
   * difference between this line and the provider's own report.
   */
  noteUnreportedUsage(): void {
    this.sessionUsage.unreportedUsageRequests =
      (this.sessionUsage.unreportedUsageRequests ?? 0) + 1;

    const session = this.getCurrentSession();
    session.usage = { ...this.sessionUsage };
    saveSession();
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

export function getCurrentSessionId(): string {
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
    // The live session owns its transcript while this process is writing it;
    // a detached save (import, subagent) only checks the lease in the store.
    acquireActiveLease(session.sessionId);
    historyAdapter.save(sessionToSave);
  } catch (error) {
    logger.error("Error saving session:", error);
  }
}

/**
 * Load session from current terminal's session file
 */
export function loadSession(): Session | null {
  try {
    // A delegated run is reachable from its parent, so resume must land on a
    // root conversation even when the child transcript was written last, and
    // a resume without an explicit id stays inside the current workspace.
    const candidates = sessionStore.list({
      cwd: process.cwd(),
      limit: 1,
    });
    const newest = candidates[0];
    if (!newest) return null;

    const session = loadSessionById(newest.sessionId);
    if (!session) return null;

    acquireActiveLease(session.sessionId);
    SessionManager.getInstance().setSession(session);
    return session;
  } catch (error) {
    logger.error("Error loading session:", error);
    return null;
  }
}

export interface CreateSessionOptions {
  source?: SessionSource;
  /** Write the header immediately, before the first message. ACP needs this. */
  persistEmpty?: boolean;
  /** Hold the file lease for this session. */
  lease?: boolean;
}

/**
 * Create a new session
 */
export function createSession(
  history: ChatHistoryItem[] = [],
  sessionId?: string,
  options: CreateSessionOptions = {},
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
  sessionStore.ensureSession(session, {
    source: options.source,
    persistEmpty: options.persistEmpty,
  });
  SessionManager.getInstance().setSession(session);
  if (options.lease) acquireActiveLease(session.sessionId);
  return session;
}

/**
 * Clear the current session
 */
export function clearSession(): void {
  try {
    const manager = SessionManager.getInstance();
    if (manager.hasSession()) {
      const sessionId = manager.getSessionId();
      releaseActiveLease();
      // The store removes the transcript, sidecars and any legacy row; the
      // old unlink left sidecar directories behind.
      historyAdapter.delete(sessionId);
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
  const sessionId = manager.getSessionId();
  return (
    fs.existsSync(getTranscriptPath(sessionId)) ||
    fs.existsSync(getLegacySessionPath(sessionId))
  );
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
    // The store's meta cache already carries the title, preview and timestamp,
    // so listing no longer opens every transcript.
    const localSessions = historyAdapter.list({
      limit,
    }) as ExtendedSessionMetadata[];

    const remoteSessions = await getRemoteSessions();

    return [
      ...localSessions.map((session) => ({ ...session, isRemote: false })),
      ...remoteSessions,
    ]
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.dateCreated).getTime() -
          new Date(a.updatedAt ?? a.dateCreated).getTime(),
      )
      .slice(0, limit);
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
    assertSessionId(sessionId);
    return historyAdapter.load(sessionId);
  } catch (error) {
    // A missing session and a corrupt transcript are both "cannot open"; the
    // old loader turned the corrupt case into an empty session and the next
    // save overwrote the file.
    logger.error("Error loading session by ID:", error);
    return null;
  }
}

/**
 * Load a specific session and make it the one later saves append to.
 */
export function selectSession(sessionId: string): Session | null {
  const session = loadSessionById(sessionId);
  if (!session) {
    return null;
  }
  try {
    acquireActiveLease(sessionId);
  } catch (error) {
    logger.error("Could not lease session:", error);
    return null;
  }
  SessionManager.getInstance().setSession(session);
  return session;
}

/**
 * The session a resume should land on: the explicitly requested one when it
 * still exists, otherwise the newest root conversation.
 */
export function resumeSession(sessionId?: string): Session | null {
  return sessionId ? selectSession(sessionId) : loadSession();
}

/**
 * Load an existing session by ID or create a new one with that ID.
 * Useful for long-lived processes (e.g., tnt serve) that need to
 * preserve chat history across restarts for the same storage/agent id.
 */
export function loadOrCreateSessionById(
  sessionId: string,
  history: ChatHistoryItem[] = [],
  options: CreateSessionOptions = {},
): Session {
  const existing = loadSessionById(sessionId);
  if (existing) {
    acquireActiveLease(sessionId);
    SessionManager.getInstance().setSession(existing);
    return existing;
  }

  return createSession(history, sessionId, {
    source: options.source ?? "serve",
    persistEmpty: options.persistEmpty ?? true,
    lease: options.lease ?? true,
  });
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

/**
 * Output style chosen for this session. The choice rides along with the session
 * so a resumed conversation keeps the tone the user picked, and it outranks a
 * style a plugin forces on.
 */
export function getSessionOutputStyle(): string | undefined {
  const chosen = SessionManager.getInstance().getCurrentSession().outputStyle;
  return chosen?.trim() || undefined;
}

export function setSessionOutputStyle(name: string | undefined): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  const normalized = name?.trim();
  if (normalized) {
    session.outputStyle = normalized;
  } else {
    delete session.outputStyle;
  }
  manager.updateHistory(session.history);
}

export function getSessionPromptProfile(): string | undefined {
  const chosen = SessionManager.getInstance().getCurrentSession().promptProfile;
  return chosen?.trim() || undefined;
}

/**
 * Stored on the session like the output style, so a resumed conversation is
 * still in the mode of work it was in, and a new session starts at the default
 * rather than inheriting one nobody chose.
 */
export function setSessionPromptProfile(name: string | undefined): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  const normalized = name?.trim();
  if (normalized) {
    session.promptProfile = normalized;
  } else {
    delete session.promptProfile;
  }
  manager.updateHistory(session.history);
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

  historyAdapter.save(getSessionPersistenceSnapshot(child));
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
    return sessionStore
      .list({
        parentSessionId,
        includeSubagents: true,
      })
      .map((metadata) => ({ ...metadata, isRemote: false }));
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

  // Clear the current session from memory (don't delete the file) and stop
  // owning its transcript before switching to the new one.
  releaseActiveLease();
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

  sessionStore.ensureSession(newSession);
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
  unpriced: boolean = false,
): void {
  SessionManager.getInstance().trackUsage(cost, usage, kind, unpriced);
}

/**
 * Count a request whose usage never arrived, so the session says how many of
 * its requests the numbers beside it actually cover.
 */
export function noteUnreportedRequest(): void {
  SessionManager.getInstance().noteUnreportedUsage();
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
