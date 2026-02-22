/* eslint-disable max-classes-per-file, max-lines */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { isDeepStrictEqual } from "util";

import type {
  BaseSessionMetadata,
  ChatHistoryItem,
  Session,
} from "core/index.js";
import { writeFileAtomically } from "core/util/atomicWrite.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
import { canonicalPath } from "../utils/canonicalPath.js";
import { logger } from "../utils/logger.js";

import {
  assertSessionId,
  ensureSessionRoot,
  getLegacySessionPath,
  getLegacySessionScopedDir,
  getLegacySessionsListPath,
  getSessionDir,
  getSessionLeasePath,
  getSessionMetaPath,
  getSessionRoot,
  getTranscriptPath,
} from "./paths.js";

/**
 * The persisted form of one session.
 *
 * The transcript is append-only. `meta.json` is a derived cache for listing:
 * it can always be rebuilt from the log, and it is written atomically so a
 * concurrent reader never sees half a session.
 */
export type SessionSource =
  "cli" | "acp" | "serve" | "subagent" | "import" | "review";

export interface SessionMeta extends BaseSessionMetadata {
  dateCreated: string;
  updatedAt: string;
  firstUserMessage?: string;
  source: SessionSource;
  parentSessionId?: string;
  subagentType?: string;
  delegationDepth?: number;
  schemaVersion: 2;
  entryCount: number;
  sizeBytes: number;
}

export interface SessionHeaderRecord {
  type: "session";
  version: 2;
  sessionId: string;
  createdAt: string;
  cwd: string;
  title: string;
  source: SessionSource;
  parentSessionId?: string;
  subagentType?: string;
  delegationDepth?: number;
}

export interface SessionMessageRecord {
  type: "message";
  messageId: string;
  parentId: string | null;
  timestamp: string;
  item: ChatHistoryItem;
}

export interface SessionMessagePatchRecord {
  type: "message-patch";
  messageId: string;
  timestamp: string;
  item: ChatHistoryItem;
}

export interface SessionCompactionRecord {
  type: "compaction";
  timestamp: string;
  firstKeptMessageId: string;
  /** The visible history after compaction; the log keeps the older bodies. */
  history: ChatHistoryItem[];
  summary?: string;
}

export interface SessionInfoRecord {
  type: "session-info";
  timestamp: string;
  title?: string;
  mode?: Session["mode"];
  chatModelTitle?: Session["chatModelTitle"];
  usage?: Session["usage"];
  goal?: string;
  outputStyle?: string;
  promptProfile?: string;
}

export interface SessionRewindRecord {
  type: "rewind";
  timestamp: string;
  messageId: string | null;
}

export interface SessionSnapshotRecord {
  type: "snapshot";
  timestamp: string;
  history: ChatHistoryItem[];
}

export type SessionRecord =
  | SessionHeaderRecord
  | SessionMessageRecord
  | SessionMessagePatchRecord
  | SessionCompactionRecord
  | SessionInfoRecord
  | SessionRewindRecord
  | SessionSnapshotRecord;

export interface LoadedSession {
  session: Session;
  meta: SessionMeta;
  origin: "v2" | "legacy";
}

export type SessionStoreErrorCode =
  "INVALID_ID" | "CORRUPT" | "LEASED" | "NOT_FOUND";

export class SessionStoreError extends Error {
  constructor(
    readonly code: SessionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionStoreError";
  }
}

export interface SessionLeaseHolder {
  pid: number;
  writerId: string;
  startedAt: string;
}

export class SessionLeaseError extends SessionStoreError {
  constructor(
    readonly sessionId: string,
    readonly holder?: SessionLeaseHolder,
  ) {
    super(
      "LEASED",
      `Session ${sessionId} is already open${
        holder ? ` by pid ${holder.pid}` : ""
      }`,
    );
    this.name = "SessionLeaseError";
  }
}

interface SessionScalars {
  title: string;
  mode?: Session["mode"];
  chatModelTitle?: Session["chatModelTitle"];
  usage?: Session["usage"];
  goal?: string;
  outputStyle?: string;
  promptProfile?: string;
}

interface BoundSession {
  history: ChatHistoryItem[];
  scalars: SessionScalars;
  meta: SessionMeta;
  origin: "v2" | "legacy";
  compactionIds: Set<string>;
}

export interface SessionStoreListOptions {
  cwd?: string;
  limit?: number;
  offset?: number;
  includeSubagents?: boolean;
  parentSessionId?: string;
  includeEmpty?: boolean;
}

type ItemWithId = ChatHistoryItem & { messageId?: string };

function ensureMessageId(item: ChatHistoryItem): string {
  const current = (item as ItemWithId).messageId;
  if (typeof current === "string" && current.length > 0) return current;
  const id = `msg-${randomUUID()}`;
  (item as ItemWithId).messageId = id;
  return id;
}

function isCompactionItem(item: ChatHistoryItem): boolean {
  return (
    item.conversationSummary !== undefined ||
    item.compactionCheckpoint?.kind === "compact-checkpoint"
  );
}

function scalarOf(session: Session): SessionScalars {
  return {
    title: session.title,
    mode: session.mode,
    chatModelTitle: session.chatModelTitle,
    usage: session.usage,
    goal: session.goal,
    outputStyle: session.outputStyle,
    promptProfile: session.promptProfile,
  };
}

function sameScalars(a: SessionScalars, b: SessionScalars): boolean {
  return isDeepStrictEqual(a, b);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "";
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function firstUserPreview(history: ChatHistoryItem[]): string | undefined {
  for (const item of history) {
    if (item.message.role !== "user") continue;
    const text = contentText(item.message.content).trim();
    if (text) return text.slice(0, 200);
  }
  return undefined;
}

function messageCount(history: ChatHistoryItem[]): number {
  return history.filter((item) => item.message.role === "assistant").length;
}

function nowIso(): string {
  return new Date().toISOString();
}

function chmodFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows and some sandboxes do not support the mode; the write succeeded.
  }
}

function readJsonLine(line: string): unknown {
  return JSON.parse(line) as unknown;
}

function isHeader(value: unknown): value is SessionHeaderRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "session" &&
    (value as { version?: unknown }).version === 2
  );
}

// eslint-disable-next-line max-statements
function projectRecords(records: SessionRecord[]): {
  header: SessionHeaderRecord;
  history: ChatHistoryItem[];
  scalars: SessionScalars;
  compactionIds: Set<string>;
  lastTimestamp: string;
} {
  let header: SessionHeaderRecord | undefined;
  let history: ChatHistoryItem[] = [];
  let byId = new Map<string, number>();
  const compactionIds = new Set<string>();
  let scalars: SessionScalars = { title: DEFAULT_SESSION_TITLE };
  let lastTimestamp = nowIso();

  const rebuildIndex = () => {
    byId = new Map();
    history.forEach((item, index) => {
      byId.set(ensureMessageId(item), index);
    });
  };

  for (const record of records) {
    if (record.type === "session") {
      header = record;
      scalars = { ...scalars, title: record.title };
      lastTimestamp = record.createdAt || lastTimestamp;
      continue;
    }

    lastTimestamp = record.timestamp || lastTimestamp;

    if (record.type === "message") {
      const item = record.item;
      (item as ItemWithId).messageId = record.messageId;
      history.push(item);
      byId.set(record.messageId, history.length - 1);
      continue;
    }

    if (record.type === "message-patch") {
      const index = byId.get(record.messageId);
      if (index === undefined) continue;
      (record.item as ItemWithId).messageId = record.messageId;
      history[index] = record.item;
      continue;
    }

    if (record.type === "compaction") {
      history = record.history.map((item) => {
        ensureMessageId(item);
        return item;
      });
      compactionIds.add(record.firstKeptMessageId);
      rebuildIndex();
      continue;
    }

    if (record.type === "rewind") {
      if (record.messageId === null) {
        history = [];
        byId.clear();
      } else {
        const index = byId.get(record.messageId);
        if (index !== undefined) {
          history = history.slice(0, index + 1);
          rebuildIndex();
        }
      }
      continue;
    }

    if (record.type === "snapshot") {
      history = record.history.map((item) => {
        ensureMessageId(item);
        return item;
      });
      rebuildIndex();
      continue;
    }

    if (record.type === "session-info") {
      if (record.title !== undefined) scalars.title = record.title;
      if (record.mode !== undefined) scalars.mode = record.mode;
      if (record.chatModelTitle !== undefined)
        scalars.chatModelTitle = record.chatModelTitle;
      if (record.usage !== undefined) scalars.usage = record.usage;
      if (record.goal !== undefined) scalars.goal = record.goal;
      if (record.outputStyle !== undefined)
        scalars.outputStyle = record.outputStyle;
      if (record.promptProfile !== undefined)
        scalars.promptProfile = record.promptProfile;
    }
  }

  if (!header) {
    throw new SessionStoreError(
      "CORRUPT",
      "Session transcript has no header record",
    );
  }

  return { header, history, scalars, compactionIds, lastTimestamp };
}

function legacyMeta(
  sessionId: string,
  session: Session,
  file: string,
): SessionMeta {
  const stat = fs.statSync(file);
  const history = Array.isArray(session.history) ? session.history : [];
  return {
    sessionId,
    title: session.title || DEFAULT_SESSION_TITLE,
    dateCreated: stat.birthtime.toISOString(),
    workspaceDirectory: session.workspaceDirectory || "",
    updatedAt: stat.mtime.toISOString(),
    messageCount: messageCount(history),
    entryCount: history.length,
    firstUserMessage: firstUserPreview(history),
    source: "cli",
    parentSessionId: session.parentSessionId,
    subagentType: session.subagentType,
    delegationDepth: session.delegationDepth,
    schemaVersion: 2,
    sizeBytes: stat.size,
  };
}

export class SessionStore {
  private readonly writerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly bound = new Map<string, BoundSession>();
  private readonly leases = new Map<string, SessionLeaseHolder>();
  private exitHookInstalled = false;

  /**
   * Bind a fresh session to the store. With `persistEmpty` the header is
   * written immediately; ACP uses that so `session/list` can see a session
   * before its first prompt.
   */
  ensureSession(
    session: Session,
    options: { source?: SessionSource; persistEmpty?: boolean } = {},
  ): void {
    assertSessionId(session.sessionId);
    const already = this.load(session.sessionId);
    if (already) return;

    if (options.persistEmpty || session.history.length > 0) {
      this.createFromSession(session, options.source ?? "cli");
      return;
    }

    const meta = this.buildMeta(session, options.source ?? "cli");
    this.bound.set(session.sessionId, {
      history: session.history,
      scalars: scalarOf(session),
      meta,
      origin: "v2",
      compactionIds: new Set(),
    });
  }

  acquireLease(sessionId: string): void {
    assertSessionId(sessionId);
    this.installExitHook();
    if (this.leases.has(sessionId)) return;

    const root = ensureSessionRoot(sessionId);
    const lockPath = getSessionLeasePath(sessionId);
    const holder: SessionLeaseHolder = {
      pid: process.pid,
      writerId: this.writerId,
      startedAt: nowIso(),
    };

    const tryWrite = (): boolean => {
      try {
        const fd = fs.openSync(lockPath, "wx", 0o600);
        try {
          fs.writeFileSync(fd, JSON.stringify(holder));
        } finally {
          fs.closeSync(fd);
        }
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    };

    if (!tryWrite()) {
      const existing = this.readLease(lockPath);
      const sameProcess = existing?.pid === process.pid;
      if (existing && !sameProcess && this.isAlive(existing.pid)) {
        throw new SessionLeaseError(sessionId, existing);
      }
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // A concurrent holder may have removed it already.
      }
      if (!tryWrite()) {
        const holderNow = this.readLease(lockPath);
        throw new SessionLeaseError(sessionId, holderNow ?? undefined);
      }
    }

    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.leases.set(sessionId, holder);
  }

  releaseLease(sessionId: string): void {
    const holder = this.leases.get(sessionId);
    if (!holder) return;
    this.leases.delete(sessionId);
    const lockPath = getSessionLeasePath(sessionId);
    const current = this.readLease(lockPath);
    if (current?.writerId === holder.writerId) {
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // Best effort: a deleted session takes the lock with it.
      }
    }
  }

  releaseAll(): void {
    for (const sessionId of [...this.leases.keys()]) {
      this.releaseLease(sessionId);
    }
  }

  isLeasedByAnotherProcess(sessionId: string): boolean {
    const holder = this.readLease(getSessionLeasePath(sessionId));
    return Boolean(
      holder && holder.pid !== process.pid && this.isAlive(holder.pid),
    );
  }

  load(sessionId: string): LoadedSession | null {
    assertSessionId(sessionId);

    const transcript = getTranscriptPath(sessionId);
    if (fs.existsSync(transcript)) {
      return this.loadTranscript(sessionId, transcript);
    }

    const legacyPath = getLegacySessionPath(sessionId);
    if (!fs.existsSync(legacyPath)) return null;

    const session = this.readLegacy(sessionId, legacyPath);
    const meta = legacyMeta(sessionId, session, legacyPath);
    this.bound.set(sessionId, {
      history: session.history,
      scalars: scalarOf(session),
      meta,
      origin: "legacy",
      compactionIds: new Set(),
    });
    return { session, meta, origin: "legacy" };
  }

  /**
   * Persist one live session. Appends only what changed; a compaction that
   * replaced the visible history writes a compaction record instead of
   * rewriting or deleting the earlier bodies.
   */
  // eslint-disable-next-line max-statements
  sync(session: Session): void {
    assertSessionId(session.sessionId);
    if (this.isLeasedByAnotherProcess(session.sessionId)) {
      throw new SessionLeaseError(
        session.sessionId,
        this.readLease(getSessionLeasePath(session.sessionId)) ?? undefined,
      );
    }

    const previous = this.bound.get(session.sessionId);
    if (!previous) {
      const loaded = this.load(session.sessionId);
      if (!loaded) {
        this.createFromSession(session, "cli");
        return;
      }
      if (loaded.origin === "legacy") {
        this.migrateLegacy(session, loaded.meta);
        return;
      }
      return this.sync(session);
    }

    if (previous.origin === "legacy") {
      this.migrateLegacy(session, previous.meta);
      return;
    }

    // A session created in memory (createSession/startNewSession) is bound so
    // its first save can diff, but it has no transcript yet. The first real
    // write creates the header and the current messages.
    if (!fs.existsSync(getTranscriptPath(session.sessionId))) {
      this.createFromSession(session, previous.meta.source);
      return;
    }

    const next = session.history;
    const prev = previous.history;
    const prevIds = prev.map(ensureMessageId);
    const nextIds = next.map(ensureMessageId);
    const records: SessionRecord[] = [];
    const timestamp = nowIso();

    const compactionIndex = next.findIndex(isCompactionItem);
    const compactionChanged =
      compactionIndex >= 0 &&
      (!previous.compactionIds.has(nextIds[compactionIndex]) ||
        nextIds[compactionIndex] !== prevIds[compactionIndex] ||
        next.length < prev.length);

    if (compactionChanged) {
      const summaryId = nextIds[compactionIndex];
      records.push({
        type: "compaction",
        timestamp,
        firstKeptMessageId: summaryId,
        history: next,
        summary: next[compactionIndex].conversationSummary,
      });
      previous.compactionIds.add(summaryId);
    } else {
      let common = 0;
      while (
        common < prevIds.length &&
        common < nextIds.length &&
        prevIds[common] === nextIds[common]
      ) {
        common += 1;
      }

      const isPrefixExtension =
        common === prevIds.length && nextIds.length >= prevIds.length;
      const isSimpleRewind =
        common === nextIds.length &&
        nextIds.every((id, index) => id === prevIds[index]);

      if (isPrefixExtension) {
        for (let index = 0; index < common; index += 1) {
          if (!isDeepStrictEqual(prev[index], next[index])) {
            records.push({
              type: "message-patch",
              messageId: nextIds[index],
              timestamp,
              item: next[index],
            });
          }
        }
        for (let index = common; index < next.length; index += 1) {
          records.push({
            type: "message",
            messageId: nextIds[index],
            parentId: index > 0 ? nextIds[index - 1] : null,
            timestamp,
            item: next[index],
          });
        }
      } else if (isSimpleRewind) {
        records.push({
          type: "rewind",
          timestamp,
          messageId: nextIds.length > 0 ? nextIds[nextIds.length - 1] : null,
        });
      } else {
        records.push({
          type: "snapshot",
          timestamp,
          history: next,
        });
      }
    }

    const scalars = scalarOf(session);
    if (!sameScalars(previous.scalars, scalars)) {
      records.push({
        type: "session-info",
        timestamp,
        title: scalars.title,
        mode: scalars.mode,
        chatModelTitle: scalars.chatModelTitle,
        usage: scalars.usage,
        goal: scalars.goal,
        outputStyle: scalars.outputStyle,
        promptProfile: scalars.promptProfile,
      });
    }

    if (records.length > 0) {
      this.appendRecords(session.sessionId, records);
    }

    const meta = this.buildMeta(session, previous.meta.source, previous.meta);
    this.writeMeta(session.sessionId, meta);
    this.bound.set(session.sessionId, {
      history: next,
      scalars,
      meta,
      origin: "v2",
      compactionIds: previous.compactionIds,
    });
  }

  list(options: SessionStoreListOptions = {}): SessionMeta[] {
    const sessions = new Map<string, SessionMeta>();
    const root = getSessionDir();
    const targetCwd = options.cwd
      ? canonicalPath(options.cwd).toLowerCase()
      : undefined;

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "tool-results") continue;
      const dirPath = path.join(root, entry.name);
      const transcriptPath = path.join(dirPath, "session.jsonl");
      const metaPath = path.join(dirPath, "meta.json");

      if (!fs.existsSync(metaPath)) {
        // A crash between the append and the metadata write leaves a valid
        // transcript with no cache; rebuild it rather than hiding the session.
        const rebuilt = this.refreshMetaFromTranscript(transcriptPath);
        if (rebuilt) sessions.set(rebuilt.sessionId, rebuilt);
        continue;
      }

      try {
        const meta = JSON.parse(
          fs.readFileSync(metaPath, "utf8"),
        ) as SessionMeta;
        if (!meta.sessionId) continue;
        const stat = fs.existsSync(transcriptPath)
          ? fs.statSync(transcriptPath)
          : null;
        const metaTime = Date.parse(meta.updatedAt ?? "");
        if (
          stat &&
          (!Number.isFinite(metaTime) || stat.mtimeMs > metaTime + 1_000)
        ) {
          const rebuilt = this.refreshMetaFromTranscript(transcriptPath);
          if (rebuilt) {
            sessions.set(rebuilt.sessionId, rebuilt);
            continue;
          }
        }
        sessions.set(meta.sessionId, meta);
      } catch (error) {
        logger.warn("Skipping unreadable session metadata", {
          path: metaPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const legacyList = getLegacySessionsListPath();
    if (fs.existsSync(legacyList)) {
      try {
        const rows = JSON.parse(fs.readFileSync(legacyList, "utf8")) as Array<
          BaseSessionMetadata & {
            parentSessionId?: string;
            subagentType?: string;
          }
        >;
        for (const row of rows) {
          if (!row?.sessionId || sessions.has(row.sessionId)) continue;
          const legacyPath = getLegacySessionPath(row.sessionId);
          if (!fs.existsSync(legacyPath)) continue;
          try {
            const session = this.readLegacy(row.sessionId, legacyPath);
            sessions.set(
              row.sessionId,
              legacyMeta(row.sessionId, session, legacyPath),
            );
          } catch {
            // A row with no readable transcript is not a session.
          }
        }
      } catch (error) {
        logger.warn("Could not read the legacy session list", { error });
      }
    }

    const filtered = [...sessions.values()]
      .filter((meta) => {
        if (!options.includeSubagents && meta.parentSessionId) return false;
        if (
          options.parentSessionId !== undefined &&
          meta.parentSessionId !== options.parentSessionId
        ) {
          return false;
        }
        if (!options.includeEmpty && meta.entryCount === 0) return false;
        if (targetCwd !== undefined) {
          // The canonical form, then case-folded. `path.resolve` fixes neither the
          // macOS case (`getcwd` says `/private/var`, a caller's `/var` is the same
          // directory) nor Windows' drive case, and this filter is what `tnt ls`
          // and the resume picker answer from: a session recorded under one
          // spelling disappeared when asked with the other.
          const cwd = meta.workspaceDirectory
            ? canonicalPath(meta.workspaceDirectory).toLowerCase()
            : "";
          if (!cwd || cwd !== targetCwd) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.dateCreated).getTime() -
          new Date(a.updatedAt ?? a.dateCreated).getTime(),
      );

    const offset = options.offset ?? 0;
    return options.limit
      ? filtered.slice(offset, offset + options.limit)
      : filtered;
  }

  getMeta(sessionId: string): SessionMeta | null {
    const metaPath = getSessionMetaPath(sessionId);
    if (fs.existsSync(metaPath)) {
      try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8")) as SessionMeta;
      } catch {
        // Fall through to the transcript; the cache is not the source of truth.
      }
    }
    return this.load(sessionId)?.meta ?? null;
  }

  delete(sessionId: string, options: { force?: boolean } = {}): void {
    assertSessionId(sessionId);
    if (!options.force && this.isLeasedByAnotherProcess(sessionId)) {
      throw new SessionLeaseError(
        sessionId,
        this.readLease(getSessionLeasePath(sessionId)) ?? undefined,
      );
    }

    this.releaseLease(sessionId);
    fs.rmSync(getSessionRoot(sessionId), { recursive: true, force: true });

    for (const file of [
      getLegacySessionPath(sessionId),
      `${getLegacySessionPath(sessionId)}.legacy`,
    ]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best effort.
      }
    }

    for (const kind of ["tool-results", "cache-breaks", "block-overflow"]) {
      try {
        fs.rmSync(getLegacySessionScopedDir(kind, sessionId), {
          recursive: true,
          force: true,
        });
      } catch {
        // Best effort.
      }
    }

    this.removeLegacyIndexRow(sessionId);
    this.bound.delete(sessionId);
  }

  clearAll(): void {
    this.releaseAll();
    this.bound.clear();
    fs.rmSync(getSessionDir(), { recursive: true, force: true });
    fs.mkdirSync(getSessionDir(), { recursive: true, mode: 0o700 });
  }

  private refreshMetaFromTranscript(
    transcriptPath: string,
  ): SessionMeta | null {
    if (!fs.existsSync(transcriptPath)) return null;
    try {
      const firstLine = fs
        .readFileSync(transcriptPath, "utf8")
        .split(/\r?\n/, 1)[0]
        ?.trim();
      if (!firstLine) return null;
      const header = readJsonLine(firstLine);
      if (!isHeader(header)) return null;
      const loaded = this.loadTranscript(header.sessionId, transcriptPath);
      const stat = fs.statSync(transcriptPath);
      const meta: SessionMeta = {
        ...loaded.meta,
        updatedAt: new Date(stat.mtimeMs).toISOString(),
        sizeBytes: stat.size,
      };
      this.writeMeta(header.sessionId, meta);
      return meta;
    } catch (error) {
      logger.warn("Could not rebuild session metadata", {
        path: transcriptPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private loadTranscript(
    sessionId: string,
    transcriptPath: string,
  ): LoadedSession {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const records: SessionRecord[] = [];
    let header: SessionHeaderRecord | undefined;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        const parsed = readJsonLine(line);
        if (!header) {
          if (!isHeader(parsed)) {
            throw new SessionStoreError(
              "CORRUPT",
              `Session ${sessionId} has no valid header`,
            );
          }
          header = parsed;
          records.push(parsed);
          continue;
        }
        records.push(parsed as SessionRecord);
      } catch (error) {
        if (error instanceof SessionStoreError) throw error;
        const atEnd = lines.slice(index + 1).every((rest) => !rest.trim());
        logger.warn("Skipping malformed session record", {
          sessionId,
          line: index + 1,
          atEnd,
          error: error instanceof Error ? error.message : String(error),
        });
        if (atEnd) break;
      }
    }

    if (!header) {
      throw new SessionStoreError(
        "CORRUPT",
        `Session ${sessionId} has no valid header`,
      );
    }

    const projected = projectRecords(records);
    const stat = fs.statSync(transcriptPath);
    const metaFromDisk = this.readMeta(sessionId);
    const meta = this.buildMeta(
      {
        sessionId,
        title: projected.scalars.title || projected.header.title,
        workspaceDirectory: projected.header.cwd,
        history: projected.history,
        mode: projected.scalars.mode,
        chatModelTitle: projected.scalars.chatModelTitle,
        usage: projected.scalars.usage,
        goal: projected.scalars.goal,
        outputStyle: projected.scalars.outputStyle,
        promptProfile: projected.scalars.promptProfile,
        parentSessionId: projected.header.parentSessionId,
        subagentType: projected.header.subagentType,
        delegationDepth: projected.header.delegationDepth,
      },
      projected.header.source,
      metaFromDisk ?? undefined,
      {
        createdAt: projected.header.createdAt,
        updatedAt: metaFromDisk?.updatedAt ?? projected.lastTimestamp,
        sizeBytes: stat.size,
      },
    );

    this.bound.set(sessionId, {
      history: projected.history,
      scalars: projected.scalars,
      meta,
      origin: "v2",
      compactionIds: projected.compactionIds,
    });

    return {
      session: {
        sessionId,
        title: meta.title,
        workspaceDirectory: meta.workspaceDirectory,
        history: projected.history,
        mode: projected.scalars.mode,
        chatModelTitle: projected.scalars.chatModelTitle,
        usage: projected.scalars.usage,
        goal: projected.scalars.goal,
        outputStyle: projected.scalars.outputStyle,
        promptProfile: projected.scalars.promptProfile,
        parentSessionId: projected.header.parentSessionId,
        subagentType: projected.header.subagentType,
        delegationDepth: projected.header.delegationDepth,
      },
      meta,
      origin: "v2",
    };
  }

  private createFromSession(session: Session, source: SessionSource): void {
    const sessionId = session.sessionId;
    ensureSessionRoot(sessionId);
    const timestamp = nowIso();
    const header: SessionHeaderRecord = {
      type: "session",
      version: 2,
      sessionId,
      createdAt: timestamp,
      cwd: session.workspaceDirectory,
      title: session.title,
      source,
      parentSessionId: session.parentSessionId,
      subagentType: session.subagentType,
      delegationDepth: session.delegationDepth,
    };

    const records: SessionRecord[] = [header];
    let parentId: string | null = null;
    const compactionIds = new Set<string>();
    for (const item of session.history) {
      const messageId = ensureMessageId(item);
      records.push({
        type: "message",
        messageId,
        parentId,
        timestamp,
        item,
      });
      parentId = messageId;
      if (isCompactionItem(item)) compactionIds.add(messageId);
    }

    const scalars = scalarOf(session);
    records.push({
      type: "session-info",
      timestamp,
      title: scalars.title,
      mode: scalars.mode,
      chatModelTitle: scalars.chatModelTitle,
      usage: scalars.usage,
      goal: scalars.goal,
      outputStyle: scalars.outputStyle,
      promptProfile: scalars.promptProfile,
    });

    this.writeTranscript(sessionId, records);
    const meta = this.buildMeta(session, source);
    this.writeMeta(sessionId, meta);
    this.bound.set(sessionId, {
      history: session.history,
      scalars,
      meta,
      origin: "v2",
      compactionIds,
    });
  }

  private migrateLegacy(session: Session, meta: SessionMeta): void {
    const legacyPath = getLegacySessionPath(session.sessionId);
    this.createFromSession(session, meta.source);
    try {
      if (fs.existsSync(legacyPath)) {
        fs.renameSync(legacyPath, `${legacyPath}.legacy`);
      }
    } catch (error) {
      logger.warn("Could not archive the legacy session file", {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private readLegacy(sessionId: string, file: string): Session {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Session;
    if (!parsed || !Array.isArray(parsed.history)) {
      throw new SessionStoreError(
        "CORRUPT",
        `Legacy session ${sessionId} has no history array`,
      );
    }
    return {
      ...parsed,
      sessionId,
      title: parsed.title || DEFAULT_SESSION_TITLE,
      workspaceDirectory: parsed.workspaceDirectory || "",
      history: parsed.history,
    };
  }

  private writeTranscript(sessionId: string, records: SessionRecord[]): void {
    const file = getTranscriptPath(sessionId);
    const body =
      records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    fs.writeFileSync(file, body, { mode: 0o600 });
    chmodFile(file);
  }

  private appendRecords(sessionId: string, records: SessionRecord[]): void {
    if (records.length === 0) return;
    const file = getTranscriptPath(sessionId);
    if (!fs.existsSync(file)) {
      throw new SessionStoreError(
        "CORRUPT",
        `Cannot append to missing transcript ${file}`,
      );
    }
    const body =
      records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    fs.appendFileSync(file, body, { mode: 0o600 });
  }

  private readMeta(sessionId: string): SessionMeta | null {
    const metaPath = getSessionMetaPath(sessionId);
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf8")) as SessionMeta;
    } catch {
      return null;
    }
  }

  private writeMeta(sessionId: string, meta: SessionMeta): void {
    ensureSessionRoot(sessionId);
    const metaPath = getSessionMetaPath(sessionId);
    writeFileAtomically(metaPath, JSON.stringify(meta, null, 2));
    chmodFile(metaPath);
  }

  private buildMeta(
    session: Session,
    source: SessionSource,
    previous?: SessionMeta,
    overrides: {
      createdAt?: string;
      updatedAt?: string;
      sizeBytes?: number;
    } = {},
  ): SessionMeta {
    const transcript = getTranscriptPath(session.sessionId);
    const sizeBytes = fs.existsSync(transcript)
      ? fs.statSync(transcript).size
      : 0;
    return {
      sessionId: session.sessionId,
      title: session.title || previous?.title || DEFAULT_SESSION_TITLE,
      workspaceDirectory: session.workspaceDirectory,
      dateCreated:
        overrides.createdAt ??
        previous?.dateCreated ??
        new Date().toISOString(),
      updatedAt: overrides.updatedAt ?? nowIso(),
      messageCount: messageCount(session.history),
      entryCount: session.history.length,
      firstUserMessage: firstUserPreview(session.history),
      source: previous?.source ?? source,
      parentSessionId: session.parentSessionId,
      subagentType: session.subagentType,
      delegationDepth: session.delegationDepth,
      schemaVersion: 2,
      sizeBytes: overrides.sizeBytes ?? sizeBytes,
    };
  }

  private readLease(lockPath: string): SessionLeaseHolder | null {
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as SessionLeaseHolder;
      if (
        typeof parsed?.pid === "number" &&
        typeof parsed?.writerId === "string"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  private removeLegacyIndexRow(sessionId: string): void {
    const listPath = getLegacySessionsListPath();
    if (!fs.existsSync(listPath)) return;
    try {
      const rows = JSON.parse(fs.readFileSync(listPath, "utf8")) as Array<{
        sessionId?: string;
      }>;
      const filtered = rows.filter((row) => row?.sessionId !== sessionId);
      if (filtered.length === rows.length) return;
      writeFileAtomically(listPath, JSON.stringify(filtered, undefined, 2));
    } catch (error) {
      logger.warn("Could not update the legacy session list", { error });
    }
  }

  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.once("exit", () => this.releaseAll());
  }
}

export const sessionStore = new SessionStore();
