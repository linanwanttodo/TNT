import fs from "fs";

import type {
  BaseSessionMetadata,
  ChatHistoryItem,
  Session,
  SessionUsage,
  TeamMemberRunStatus,
  TeamRunMemberRecord,
  TeamRunMode,
  TeamRunRecord,
  TeamRunStatus,
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
import { repairDanglingToolCalls } from "./repairDanglingToolCalls.js";
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

    // A crash can leave a declared tool call without its result on disk, and
    // a provider refuses that history; close the gaps before anything reads it.
    session.history = repairDanglingToolCalls(session.history);

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
  // Same repair as loadSession: a resumed transcript must not carry a tool
  // call the provider never saw answered.
  session.history = repairDanglingToolCalls(session.history);
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
 * The /team roster activated for this session, by name. The dispatch chain
 * reads it to widen the list of agents a model may delegate to, and the
 * system message reads it to inject the roster's lead prompt. In-memory
 * session state (v1): it survives a resume through the session store but
 * nothing outside the session sets it.
 */
export function getSessionActiveTeam(): string | undefined {
  const chosen = SessionManager.getInstance().getCurrentSession().activeTeam;
  return chosen?.trim() || undefined;
}

export function setSessionActiveTeam(name: string | undefined): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  const normalized = name?.trim();
  if (normalized) {
    session.activeTeam = normalized;
  } else {
    delete session.activeTeam;
  }
  manager.updateHistory(session.history);
}

/**
 * Run-time model assignments for the active team, keyed by member name. Kept
 * beside activeTeam and persisted with the session, so a resumed conversation
 * dispatches each member on the model the main agent chose. A getter returns a
 * copy: the session store diffs the scalar it owns, so a caller that mutated
 * the returned object would change it without a save.
 */
export function getSessionTeamModelOverrides():
  Record<string, string> | undefined {
  const overrides =
    SessionManager.getInstance().getCurrentSession().teamModelOverrides;
  return overrides && Object.keys(overrides).length > 0
    ? { ...overrides }
    : undefined;
}

export function getSessionTeamModelOverride(
  memberName: string,
): string | undefined {
  const normalized = memberName?.trim();
  if (!normalized) return undefined;
  const value =
    SessionManager.getInstance().getCurrentSession().teamModelOverrides?.[
      normalized
    ];
  return value?.trim() || undefined;
}

/**
 * Record that a member runs on `modelName` for subsequent dispatches.
 *
 * Storage only: the caller validates the member against the active roster and
 * the model against the configuration before it gets here. Keeping that
 * validation in the tools layer is what lets the session module stay free of
 * service and roster imports, so `session` never reaches up into `services`.
 * The model resolves the way dispatch resolves it (configured entry name or
 * model id), and the roster's persona is untouched.
 */
export function setSessionTeamModelOverride(
  memberName: string,
  modelName: string,
): void {
  const member = typeof memberName === "string" ? memberName.trim() : "";
  const model = typeof modelName === "string" ? modelName.trim() : "";

  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  session.teamModelOverrides = {
    ...(session.teamModelOverrides ?? {}),
    [member]: model,
  };
  manager.updateHistory(session.history);
}

/**
 * Remove one member's assignment, or every assignment when called with no
 * member name. The empty object is kept rather than deleted: a session-info
 * record only carries the scalar when it changed, so a deleted property would
 * look like "unchanged" on the next load and the clear would be lost.
 */
export function clearSessionTeamModelOverride(memberName?: string): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  if (!session.teamModelOverrides) return;

  if (memberName === undefined) {
    session.teamModelOverrides = {};
  } else {
    const next = { ...session.teamModelOverrides };
    delete next[memberName.trim()];
    session.teamModelOverrides = next;
  }
  manager.updateHistory(session.history);
}

/**
 * Bound on the run history a session keeps. A ledger is a record of what ran,
 * not an archive of the conversation; twenty runs is enough to show the current
 * work and the recent past while keeping the persisted scalar small.
 */
export const MAX_TEAM_RUNS = 20;

/**
 * Bound on the members one summon may dispatch. A roster larger than this is a
 * mistake (or an attempt to fan out without a plan) and is refused rather than
 * truncated, so the caller learns why nothing ran.
 */
export const MAX_TEAM_RUN_MEMBERS = 16;

/**
 * The run a member dispatch belongs to. SummonTeam sets it before dispatching
 * the lead and clears it when the lead finishes, so the executor can attribute
 * every Subagent call the lead makes without either tool passing a context
 * through the model's tool arguments.
 */
let currentTeamRunId: string | undefined;

export interface BeginTeamRunOptions {
  team: string;
  goal: string;
  mode: TeamRunMode;
  /** Member names, already validated against the roster by the caller. */
  members: string[];
}

function saveSessionScalars(): void {
  // The ledger is a session scalar, so the store's scalar diff is the save
  // path. saveSession() is used rather than updateHistory() because bumping
  // the history generation would invalidate an in-flight auto-compaction.
  saveSession();
}

function mutateTeamRuns(
  mutate: (runs: TeamRunRecord[]) => TeamRunRecord[],
): void {
  const manager = SessionManager.getInstance();
  const session = manager.getCurrentSession();
  session.teamRuns = mutate(session.teamRuns ?? []).slice(-MAX_TEAM_RUNS);
  saveSessionScalars();
}

/**
 * Open a team run and make it the current one. Returns the record so the
 * caller can finish it by id even if the session is replaced meanwhile.
 */
export function beginTeamRun(options: BeginTeamRunOptions): TeamRunRecord {
  const run: TeamRunRecord = {
    runId: `team-${uuidv4().slice(0, 8)}`,
    team: options.team.trim(),
    goal: options.goal.trim(),
    mode: options.mode,
    startedAt: new Date().toISOString(),
    status: "running",
    members: options.members
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, MAX_TEAM_RUN_MEMBERS)
      .map((name) => ({ name, status: "pending" as TeamMemberRunStatus })),
  };

  mutateTeamRuns((runs) => [...runs, run]);
  currentTeamRunId = run.runId;
  return run;
}

/** A copy: callers read the ledger, the setter owns the persisted object. */
export function getSessionTeamRuns(): TeamRunRecord[] {
  const runs = SessionManager.getInstance().getCurrentSession().teamRuns ?? [];
  return runs.map((run) => ({
    ...run,
    members: run.members.map((member) => ({ ...member })),
  }));
}

export function getCurrentTeamRunId(): string | undefined {
  return currentTeamRunId;
}

function currentRun(): TeamRunRecord | undefined {
  if (!currentTeamRunId) return undefined;
  return SessionManager.getInstance()
    .getCurrentSession()
    .teamRuns?.find((run) => run.runId === currentTeamRunId);
}

/**
 * The current run when `memberName` is one of its members. The lead is not a
 * member, so the lead's own dispatch is not attributed as member work.
 */
export function getCurrentTeamRunMember(
  memberName: string,
): { runId: string } | undefined {
  const run = currentRun();
  if (!run) return undefined;
  const name = memberName?.trim();
  return run.members.some((member) => member.name === name)
    ? { runId: run.runId }
    : undefined;
}

export function startTeamMemberRun(
  runId: string,
  memberName: string,
  model?: string,
): void {
  mutateTeamRuns((runs) =>
    runs.map((run) => {
      if (run.runId !== runId || run.status !== "running") return run;
      return {
        ...run,
        members: run.members.map((member) => {
          if (member.name !== memberName) return member;
          return {
            name: member.name,
            ...(model ? { model } : {}),
            status: "running" as TeamMemberRunStatus,
            startedAt: new Date().toISOString(),
          };
        }),
      };
    }),
  );
}

export function finishTeamMemberRun(
  runId: string,
  memberName: string,
  outcome: {
    success: boolean;
    subagentSessionId?: string;
    error?: string;
  },
): void {
  mutateTeamRuns((runs) =>
    runs.map((run) => {
      if (run.runId !== runId || run.status !== "running") return run;
      return {
        ...run,
        members: run.members.map((member) => {
          if (member.name !== memberName) return member;
          const finished: TeamRunMemberRecord = {
            ...member,
            status: (outcome.success
              ? "completed"
              : "failed") as TeamMemberRunStatus,
            finishedAt: new Date().toISOString(),
          };
          if (outcome.subagentSessionId) {
            finished.subagentSessionId = outcome.subagentSessionId;
          }
          if (!outcome.success && outcome.error) {
            finished.error = outcome.error;
          } else {
            delete finished.error;
          }
          return finished;
        }),
      };
    }),
  );
}

/**
 * Settle a run. Called on every exit from SummonTeam, so a failed lead does not
 * leave the ledger claiming the run is still active.
 */
export function finishTeamRun(runId: string, status: TeamRunStatus): void {
  mutateTeamRuns((runs) =>
    runs.map((run) => (run.runId === runId ? { ...run, status } : run)),
  );
  if (currentTeamRunId === runId) {
    currentTeamRunId = undefined;
  }
}

/** Test and /clear seam: forget the ledger and any in-flight run id. */
export function clearSessionTeamRuns(): void {
  currentTeamRunId = undefined;
  mutateTeamRuns(() => []);
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
  /**
   * The depth the dispatch actually ran at. A team member is dispatched from
   * inside the lead's run, so reading the live session's depth here would
   * record the lead's parent rather than the member's own level.
   */
  delegationDepth?: number;
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
      options.delegationDepth ??
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
