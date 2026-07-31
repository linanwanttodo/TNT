import { realpathSync } from "node:fs";
import path from "node:path";

import {
  elideSessionSnapshotForIndex,
  zcodeSessionCloseParamsSchema,
  zcodeSessionCreateParamsSchema,
  zcodeSessionListParamsSchema,
  zcodeSessionMessagesParamsSchema,
  zcodeSessionReadParamsSchema,
  zcodeSessionResumeParamsSchema,
  zcodeSessionSetModelParamsSchema,
} from "@zcode/shared";
import type {
  ModelSelection,
  ZCodeMessageWithParts,
  ZCodeSessionCreateParams,
  ZCodeSessionInfo,
  ZCodeSessionStateSnapshot,
} from "@zcode/shared";
import type { ChatHistoryItem, Session } from "core/index.js";

import { serviceContainer } from "../services/ServiceContainer.js";
import type { ModelServiceState } from "../services/types.js";
import {
  createSession,
  getLiveSession,
  loadSessionById,
  resumeSession,
} from "../session/index.js";
import {
  sessionStore,
  setMessageTimestamp,
  type SessionMeta,
} from "../session/store.js";

import { SessionRuntimeStore } from "./runtime.js";
import {
  toZcodeMessages,
  toZcodeSessionInfo,
  toZcodeSnapshot,
  type SessionStatus,
} from "./snapshot.js";

const MODEL_SERVICE_NAME = "model";
const INVALID_PARAMS_CODE = -32602;
const INTERNAL_ERROR_CODE = -32603;
const REQUEST_ERROR_CODES = new Set([
  -32601,
  INVALID_PARAMS_CODE,
  INTERNAL_ERROR_CODE,
]);

export interface SessionRequestError extends Error {
  code: number;
}

export function sessionRequestError(
  message: string,
  code: number = INVALID_PARAMS_CODE,
): SessionRequestError {
  const error = new Error(message) as SessionRequestError;
  error.code = code;
  return error;
}

export function isSessionRequestError(
  error: unknown,
): error is SessionRequestError {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "number" && REQUEST_ERROR_CODES.has(code);
}

export interface AvailableChatModel {
  provider: string;
  name: string;
  index: number;
  /** The configured model id (`model.model`), when the lookup exposes it. */
  model?: string;
}

export interface ModelLookup {
  getAvailableChatModels(): AvailableChatModel[];
}

export interface SessionNotificationSender {
  send(message: unknown): Promise<void>;
}

/**
 * The host uses this to grow the connection's allowed workspace roots when a
 * request names a workspace the process has not seen yet. A child app-server
 * does not install one: it only ever serves its own cwd.
 */
export interface SessionWorkspaceRegistrar {
  add(workspacePath: string): void | Promise<void>;
}

export interface SessionHandlerOptions {
  sender: SessionNotificationSender;
  modelLookup?: ModelLookup | null;
  runtimes?: SessionRuntimeStore;
  workspaces?: SessionWorkspaceRegistrar;
  /** The one workspace this process serves; omitted when it serves any. */
  workspacePath?: string;
  /**
   * A live TUI runtime is sharing this process: a browser "create" that only
   * names a workspace (a directory pick) must keep the conversation the
   * screen is already running instead of silently starting another one.
   */
  reuseLiveSession?: () => Session | null;
  /** The browser resumed a session; the screen follows it. */
  onLiveSessionResumed?: (sessionId: string) => void;
}

function canonicalWorkspace(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    // `realpathSync.native` expands Windows 8.3 short names (RUNNER~1), which
    // the JavaScript implementation leaves in place.
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/** Windows paths are case-insensitive and may arrive in either separator form. */
function sameWorkspace(left: string, right: string): boolean {
  if (process.platform !== "win32") {
    return left === right;
  }
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export type TitleSource = "default" | "first_input" | "generated" | "custom";

export interface SessionListResult {
  sessions: ZCodeSessionInfo[];
}

export interface SessionMessagesResult {
  messages: ZCodeMessageWithParts[];
}

export interface SessionCloseResult {
  closed: boolean;
}

interface ParseableSchema<T> {
  parse(value: unknown): T;
}

export function parseParams<T>(schema: ParseableSchema<T>, params: unknown): T {
  try {
    return schema.parse(params ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw sessionRequestError(`Invalid params: ${message}`);
  }
}

type ImportedHistory = NonNullable<ZCodeSessionCreateParams["importedHistory"]>;

/**
 * Imported conversations become ordinary history items, so the snapshot and
 * the message projection map them exactly like a locally recorded session.
 */
function importedHistoryItems(imported: ImportedHistory): ChatHistoryItem[] {
  if (imported.source === "claudeCode") {
    return imported.messages.map((message) => {
      const item: ChatHistoryItem = {
        message: { role: message.role, content: message.content },
        contextItems: [],
      };
      const timestamp = message.timestamp ?? imported.createdAt;
      if (timestamp !== undefined) {
        setMessageTimestamp(item, new Date(timestamp).toISOString());
      }
      return item;
    });
  }
  const item: ChatHistoryItem = {
    message: { role: "user", content: imported.markdown },
    contextItems: [],
  };
  if (imported.createdAt !== undefined) {
    setMessageTimestamp(item, new Date(imported.createdAt).toISOString());
  }
  return [item];
}

export class SessionHandlers {
  private readonly models = new Map<string, ModelSelection>();
  private readonly sender: SessionNotificationSender;
  private readonly configuredLookup: ModelLookup | null | undefined;
  private readonly runtimes: SessionRuntimeStore;
  private readonly workspaces: SessionWorkspaceRegistrar | undefined;
  private readonly workspacePath: string | undefined;
  private readonly reuseLiveSession: (() => Session | null) | undefined;
  private readonly onLiveSessionResumed:
    ((sessionId: string) => void) | undefined;

  constructor(options: SessionHandlerOptions) {
    this.sender = options.sender;
    this.configuredLookup = options.modelLookup;
    this.runtimes = options.runtimes ?? new SessionRuntimeStore();
    this.workspaces = options.workspaces;
    this.workspacePath = options.workspacePath
      ? canonicalWorkspace(options.workspacePath)
      : undefined;
    this.reuseLiveSession = options.reuseLiveSession;
    this.onLiveSessionResumed = options.onLiveSessionResumed;
  }

  async create(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionCreateParamsSchema, params);
    this.assertWorkspace(input.workspace.workspacePath);
    await this.registerWorkspace(input.workspace.workspacePath);
    // The shared conversation continues across a directory pick: the screen
    // owns the session, the browser only re-points its working directory.
    const live = this.reuseLiveSession?.() ?? null;
    if (live && !input.sessionId) {
      live.workspaceDirectory = input.workspace.workspacePath;
      sessionStore.sync(live);
      return this.snapshot(live);
    }
    if (input.sessionId && sessionStore.getMeta(input.sessionId)) {
      throw sessionRequestError(`Session already exists: ${input.sessionId}`);
    }
    if (input.model) {
      const known = await this.isKnownModel(input.model);
      if (known === false) {
        throw sessionRequestError(
          `Unknown model: ${input.model.providerId}/${input.model.modelId}`,
        );
      }
      if (known === null) {
        throw sessionRequestError(
          "Model service is not ready",
          INTERNAL_ERROR_CODE,
        );
      }
    }
    const session = createSession([], input.sessionId, {
      source: input.importedHistory ? "import" : "serve",
      persistEmpty: false,
    });
    session.workspaceDirectory = input.workspace.workspacePath;
    (session as Session & { workspaceIdentity?: string }).workspaceIdentity =
      input.workspace.workspaceIdentity;
    session.mode = input.mode === "plan" ? "plan" : "agent";
    session.history = input.importedHistory
      ? importedHistoryItems(input.importedHistory)
      : [];
    const importedTitle = input.importedHistory?.title;
    if (importedTitle) {
      session.title = importedTitle;
    }
    if (input.model) {
      this.rememberModel(session, input.model);
    }
    sessionStore.sync(session);
    return this.snapshot(session);
  }

  /**
   * The v4 draft create. Same record as `create`, but the session is not
   * written until its first turn commits a transcript: an unused prewarm must
   * not surface in the session list as an empty task. The composer's requested
   * config is applied up front so the first turn already runs on it.
   */
  async createDraft(input: {
    workspacePath: string;
    sessionId?: string;
    config?: {
      modelSelection?: ModelSelection;
      provider?: string;
      model?: string;
      mode?: string;
      planEnabled?: boolean;
    };
  }): Promise<Session> {
    this.assertWorkspace(input.workspacePath);
    await this.registerWorkspace(input.workspacePath);
    if (
      input.sessionId &&
      (sessionStore.getMeta(input.sessionId) ||
        getLiveSession(input.sessionId) !== null)
    ) {
      throw sessionRequestError(`Session already exists: ${input.sessionId}`);
    }
    const config = input.config;
    const selection =
      config?.modelSelection ??
      (config?.provider && config.model
        ? { providerId: config.provider, modelId: config.model }
        : undefined);
    const session = createSession([], input.sessionId, {
      source: "serve",
      persistEmpty: false,
    });
    if (selection) {
      // The composer prewarms a draft with its remembered pick, which can be
      // stale (config edited while the browser was closed, or the model
      // service still initializing right after a refresh). Failing the whole
      // draft for that surfaced "草稿会话创建失败" on an empty session.
      // Validate best-effort instead: an unknown pick falls back to the
      // default model, and the next explicit switch re-validates.
      const known = await this.isKnownModel(selection);
      if (known) {
        this.rememberModel(session, selection);
      }
    }
    session.workspaceDirectory = this.workspacePath ?? input.workspacePath;
    session.mode =
      config?.mode === "plan" || config?.planEnabled === true
        ? "plan"
        : "agent";
    if (selection) {
      this.rememberModel(session, selection);
    }
    return session;
  }

  async resume(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionResumeParamsSchema, params);
    if (input.workspace?.workspacePath) {
      this.assertWorkspace(input.workspace.workspacePath);
      await this.registerWorkspace(input.workspace.workspacePath);
    }
    const session = resumeSession(input.sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${input.sessionId}`);
    }
    sessionStore.setArchived(session.sessionId, false);
    // The browser picked a session from the list; the screen switches to it
    // so both sides keep showing one conversation.
    this.onLiveSessionResumed?.(session.sessionId);
    return this.snapshot(session);
  }

  async list(params: unknown): Promise<SessionListResult> {
    const input = parseParams(zcodeSessionListParamsSchema, params);
    if (input.workspace?.workspacePath) {
      this.assertWorkspace(input.workspace.workspacePath);
      await this.registerWorkspace(input.workspace.workspacePath);
    }
    // The store hides archived sessions and applies its own limit, so the
    // request limit is applied after the id filter and only here.
    const metas = sessionStore.list({
      cwd: input.workspace?.workspacePath,
      includeEmpty: true,
      includeSubagents: false,
    });
    const sessions = metas
      .filter(
        (meta) =>
          !input.sessionIds || input.sessionIds.includes(meta.sessionId),
      )
      .map((meta) => this.infoFromMeta(meta))
      .filter((info): info is ZCodeSessionInfo => info !== null);
    return {
      sessions: input.limit ? sessions.slice(0, input.limit) : sessions,
    };
  }

  async read(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionReadParamsSchema, params);
    const session = this.loadSession(input.sessionId);
    const snapshot =
      input.contentProfile === "index"
        ? elideSessionSnapshotForIndex(this.snapshot(session))
        : this.snapshot(session);
    let messages = snapshot.messages;
    if (input.afterSeq !== undefined && input.afterSeq > 0) {
      const cursor = this.runtimes.cursor(input.sessionId);
      if (cursor.eventSeq > 0 && input.afterSeq > cursor.eventSeq) {
        throw sessionRequestError(
          `afterSeq ${input.afterSeq} is ahead of the session event sequence`,
        );
      }
      const cursorTimestamp = this.runtimes.eventTimestampAt(
        input.sessionId,
        input.afterSeq,
      );
      // A retained cursor gives a real relative window; when the event has
      // rolled out of the retained log, returning nothing is honest and the
      // client must resync. The full transcript is never returned silently.
      messages =
        cursorTimestamp === null
          ? []
          : messages.filter(
              (message) => message.info.time.created > cursorTimestamp,
            );
    }
    if (input.messageLimit) {
      messages = messages.slice(-input.messageLimit);
    }
    return { ...snapshot, messages };
  }

  async messages(params: unknown): Promise<SessionMessagesResult> {
    const input = parseParams(zcodeSessionMessagesParamsSchema, params);
    let messages = toZcodeMessages(this.loadSession(input.sessionId));
    if (input.afterMessageId) {
      const index = messages.findIndex(
        (message) => message.info.messageId === input.afterMessageId,
      );
      messages = index >= 0 ? messages.slice(index + 1) : messages;
    }
    if (input.limit) {
      messages = messages.slice(0, input.limit);
    }
    return { messages };
  }

  async close(params: unknown): Promise<SessionCloseResult> {
    const input = parseParams(zcodeSessionCloseParamsSchema, params);
    const archived = sessionStore.setArchived(input.sessionId, true);
    if (archived) {
      sessionStore.releaseLease(input.sessionId);
    }
    return { closed: archived };
  }

  async setModel(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionSetModelParamsSchema, params);
    const session = this.loadSession(input.sessionId);
    // Wait for the model service before judging the pick: right after a
    // browser refresh the request can outrun service initialization, and a
    // premature throw crashes the composer's switch flow.
    const known = await this.isKnownModel(input.model);
    if (known === false) {
      throw sessionRequestError(
        `Unknown model: ${input.model.providerId}/${input.model.modelId}`,
      );
    }
    if (known === null) {
      throw sessionRequestError(
        "Model service is not ready",
        INTERNAL_ERROR_CODE,
      );
    }
    this.rememberModel(session, input.model);
    sessionStore.sync(session);
    return this.snapshot(session);
  }

  async setTitle(
    sessionId: string,
    title: string,
    source: TitleSource = "custom",
  ): Promise<ZCodeSessionStateSnapshot> {
    const session = this.loadSession(sessionId);
    const previousTitle = session.title;
    if (previousTitle !== title) {
      session.title = title;
      sessionStore.sync(session);
      // The vendored client only consumes `session/event`; a bare
      // `session/titleUpdated` notification is dropped silently.
      this.runtimes.append(sessionId, "session.titleUpdated", {
        previousTitle,
        title,
        source,
      });
    }
    return this.snapshot(session);
  }

  private loadSession(sessionId: string): Session {
    const session = loadSessionById(sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private async registerWorkspace(workspacePath: string): Promise<void> {
    if (!this.workspaces) {
      return;
    }
    await this.workspaces.add(workspacePath);
  }

  private assertWorkspace(workspacePath: string): void {
    if (!this.workspacePath) {
      return;
    }
    if (!sameWorkspace(canonicalWorkspace(workspacePath), this.workspacePath)) {
      throw sessionRequestError(
        `This engine serves ${this.workspacePath}, not ${workspacePath}`,
      );
    }
  }

  private infoFromMeta(meta: SessionMeta): ZCodeSessionInfo | null {
    const loaded = sessionStore.load(meta.sessionId);
    if (!loaded) {
      return null;
    }
    return toZcodeSessionInfo(loaded.session, {
      meta,
      model: this.modelFor(loaded.session),
    });
  }

  private snapshot(session: Session): ZCodeSessionStateSnapshot {
    return toZcodeSnapshot(session, {
      meta: sessionStore.getMeta(session.sessionId),
      model: this.modelFor(session),
      runtime: this.runtimes.cursor(session.sessionId),
      status: this.statusFor(session.sessionId),
    });
  }

  private statusFor(sessionId: string): SessionStatus {
    return this.runtimes.isTurnActive(sessionId) ? "running" : "idle";
  }

  private rememberModel(session: Session, model: ModelSelection): void {
    this.models.set(session.sessionId, model);
    session.chatModelTitle = `${model.providerId}/${model.modelId}`;
  }

  private modelFor(session: Session): ModelSelection | undefined {
    const cached = this.models.get(session.sessionId);
    if (cached) {
      return cached;
    }
    const title = session.chatModelTitle;
    if (!title) {
      return undefined;
    }
    const slash = title.indexOf("/");
    if (slash <= 0 || slash === title.length - 1) {
      return undefined;
    }
    return {
      providerId: title.slice(0, slash),
      modelId: title.slice(slash + 1),
    };
  }

  /**
   * Best-effort validation with patience: unlike a bare sync check this
   * waits (bounded) for the model service to initialize, because webui
   * requests can legitimately arrive before it is ready. Returns null when
   * the service is still unavailable after the wait — the caller decides
   * whether that is fatal.
   */
  private async isKnownModel(model: ModelSelection): Promise<boolean | null> {
    const lookup =
      (await this.resolveModelLookupWait()) ?? this.resolveModelLookup();
    if (!lookup) {
      return null;
    }
    return this.isKnownByLookup(lookup, model);
  }

  private isKnownByLookup(lookup: ModelLookup, model: ModelSelection): boolean {
    return lookup
      .getAvailableChatModels()
      .some(
        (entry) =>
          entry.provider === model.providerId &&
          (entry.model === model.modelId || entry.name === model.modelId),
      );
  }

  /** Waits (bounded) for the model service instead of failing fast. */
  private async resolveModelLookupWait(): Promise<ModelLookup | null> {
    try {
      const raced = await Promise.race([
        serviceContainer.get<ModelServiceState>(MODEL_SERVICE_NAME),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!raced) {
        return null;
      }
      return this.lookupFromService(raced);
    } catch {
      return null;
    }
  }

  private lookupFromService(service: ModelServiceState): ModelLookup | null {
    const models = (service.assistant?.models ?? []).filter(
      (model): model is NonNullable<typeof model> => Boolean(model),
    );
    return {
      getAvailableChatModels: () =>
        models.map((model, index) => ({
          provider: model.provider,
          name: model.name ?? model.model ?? "unnamed",
          model: model.model,
          index,
        })),
    };
  }

  private resolveModelLookup(): ModelLookup | null {
    if (this.configuredLookup !== undefined) {
      return this.configuredLookup;
    }
    const state =
      serviceContainer.getSync<ModelServiceState>(MODEL_SERVICE_NAME);
    if (state.state !== "ready" || !state.value) {
      return null;
    }
    // The container holds the initialized model state, not the service
    // instance, so the fallback reads the configured models directly and
    // matches a selection the same way ModelService.findModelByName does.
    return this.lookupFromService(state.value);
  }
}
