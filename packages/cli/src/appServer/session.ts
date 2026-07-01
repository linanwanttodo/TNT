import {
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
  ZCodeSessionInfo,
  ZCodeSessionStateSnapshot,
} from "@zcode/shared";
import type { Session } from "core/index.js";

import { serviceContainer } from "../services/ServiceContainer.js";
import {
  createSession,
  loadSessionById,
  resumeSession,
} from "../session/index.js";
import { sessionStore, type SessionMeta } from "../session/store.js";

import {
  toZcodeMessages,
  toZcodeSessionInfo,
  toZcodeSnapshot,
} from "./snapshot.js";

const MODEL_SERVICE_NAME = "model";
const INVALID_PARAMS_CODE = -32602;

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
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

export interface ModelLookup {
  getAvailableChatModels(): Array<{
    provider: string;
    name: string;
    index: number;
  }>;
}

export interface SessionNotificationSender {
  send(message: unknown): Promise<void>;
}

export interface SessionHandlerOptions {
  sender: SessionNotificationSender;
  modelLookup?: ModelLookup | null;
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

function parseParams<T>(schema: ParseableSchema<T>, params: unknown): T {
  try {
    return schema.parse(params ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw sessionRequestError(`Invalid params: ${message}`);
  }
}

export class SessionHandlers {
  private readonly closed = new Set<string>();
  private readonly models = new Map<string, ModelSelection>();
  private readonly sender: SessionNotificationSender;
  private readonly configuredLookup: ModelLookup | null | undefined;

  constructor(options: SessionHandlerOptions) {
    this.sender = options.sender;
    this.configuredLookup = options.modelLookup;
  }

  async create(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionCreateParamsSchema, params);
    if (input.sessionId && sessionStore.getMeta(input.sessionId)) {
      throw sessionRequestError(`Session already exists: ${input.sessionId}`);
    }
    const session = createSession([], input.sessionId, {
      source: "serve",
      persistEmpty: false,
    });
    session.workspaceDirectory = input.workspace.workspacePath;
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

  async resume(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionResumeParamsSchema, params);
    const session = resumeSession(input.sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${input.sessionId}`);
    }
    this.closed.delete(session.sessionId);
    return this.snapshot(session);
  }

  async list(params: unknown): Promise<SessionListResult> {
    const input = parseParams(zcodeSessionListParamsSchema, params);
    const metas = sessionStore.list({
      cwd: input.workspace?.workspacePath,
      includeEmpty: true,
      includeSubagents: false,
      limit: input.sessionIds ? undefined : input.limit,
    });
    const sessions = metas
      .filter((meta) => !this.closed.has(meta.sessionId))
      .filter(
        (meta) =>
          !input.sessionIds || input.sessionIds.includes(meta.sessionId),
      )
      .map((meta) => this.infoFromMeta(meta))
      .filter((info): info is ZCodeSessionInfo => info !== null);
    return { sessions };
  }

  async read(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionReadParamsSchema, params);
    return this.snapshot(this.loadSession(input.sessionId));
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
    const exists = sessionStore.getMeta(input.sessionId) !== null;
    if (exists) {
      this.closed.add(input.sessionId);
      sessionStore.releaseLease(input.sessionId);
    }
    return { closed: exists };
  }

  async setModel(params: unknown): Promise<ZCodeSessionStateSnapshot> {
    const input = parseParams(zcodeSessionSetModelParamsSchema, params);
    const session = this.loadSession(input.sessionId);
    this.assertKnownModel(input.model);
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
      await this.sender.send({
        method: "session/titleUpdated",
        params: { sessionId, previousTitle, title, source },
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
    });
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

  private assertKnownModel(model: ModelSelection): void {
    const lookup = this.resolveModelLookup();
    if (!lookup) {
      throw sessionRequestError("Model service is not ready");
    }
    const known = lookup
      .getAvailableChatModels()
      .some(
        (entry) =>
          entry.provider === model.providerId && entry.name === model.modelId,
      );
    if (!known) {
      throw sessionRequestError(
        `Unknown model: ${model.providerId}/${model.modelId}`,
      );
    }
  }

  private resolveModelLookup(): ModelLookup | null {
    if (this.configuredLookup !== undefined) {
      return this.configuredLookup;
    }
    const state = serviceContainer.getSync<ModelLookup>(MODEL_SERVICE_NAME);
    return state.state === "ready" && state.value ? state.value : null;
  }
}
