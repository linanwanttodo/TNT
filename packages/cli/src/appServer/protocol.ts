import {
  zcodeSessionCreateParamsSchema,
  zcodeSessionSetModelParamsSchema,
  ZCODE_PROTOCOL_VERSION,
  zcodeProtocolMethods,
} from "@zcode/shared";
import { V4_METHODS } from "@zcode/shared/zcode-protocol-v4";
import type { Session } from "core/index.js";

import type { InteractionBroker } from "../permissions/interactionBroker.js";
import type { ToolPermissionManager } from "../permissions/permissionManager.js";
import type { QuizService } from "../services/QuizService.js";

import {
  InteractionBridge,
  type InteractionRequestHandle,
  type InteractionSender,
} from "./interactions.js";
import { SessionRuntimeStore } from "./runtime.js";
import {
  isSessionRequestError,
  parseParams,
  SessionHandlers,
  type ModelLookup,
  type SessionWorkspaceRegistrar,
} from "./session.js";
import type { SessionRegistry } from "./sessionRegistry.js";
import {
  ensureAppServerServices,
  TurnHandlers,
  type TurnExecutor,
  type TurnPump,
  type TurnQueue,
  type TurnSources,
} from "./turns.js";
import { V4Handlers } from "./v4.js";

export const PROTOCOL_PARSE_ERROR = -32700;
export const PROTOCOL_INVALID_REQUEST = -32600;
export const PROTOCOL_METHOD_NOT_FOUND = -32601;
export const PROTOCOL_INVALID_PARAMS = -32602;
export const PROTOCOL_INTERNAL_ERROR = -32603;

export type ProtocolRequestId = string | number | null;

export interface ProtocolSender {
  send(message: unknown): Promise<void>;
}

export type ProtocolHandler = (params: unknown) => unknown | Promise<unknown>;

export interface AppServerProtocolOptions {
  modelLookup?: ModelLookup | null;
  runTurn?: TurnExecutor;
  pump?: TurnPump;
  queue?: TurnQueue;
  events?: TurnSources;
  ensureServices?: () => Promise<void>;
  /** A live TUI runtime receives the browser's text directly. */
  acceptRemoteText?: (text: string) => Promise<boolean>;
  /** A directory pick keeps the screen's conversation instead of forking. */
  reuseLiveSession?: () => Session | null;
  /** The browser resumed a session from the list. */
  onLiveSessionResumed?: (sessionId: string) => void;
  interactionBroker?: InteractionBroker;
  permissionManager?: ToolPermissionManager;
  quizService?: QuizService;
  resolveSessionId?: () => string | null;
  interactions?: boolean;
  /** The host registers workspaces named on the wire; a child does not. */
  workspaces?: SessionWorkspaceRegistrar;
  /** The one workspace this process serves; omitted when it serves any. */
  workspacePath?: string;
}

interface PendingServerRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is ProtocolRequestId {
  return (
    value === null || typeof value === "string" || typeof value === "number"
  );
}

export class AppServerProtocol {
  private readonly handlers = new Map<string, ProtocolHandler>();
  private readonly serverRequests = new Map<string, PendingServerRequest>();
  private nextServerRequestId = 0;
  readonly sessions: SessionHandlers;
  readonly turns: TurnHandlers;
  readonly interactions: InteractionBridge | null;
  readonly v4: V4Handlers;

  constructor(
    private readonly transport: ProtocolSender,
    private readonly registry: SessionRegistry,
    options: AppServerProtocolOptions = {},
  ) {
    const runtimes = new SessionRuntimeStore();
    this.sessions = new SessionHandlers({
      sender: transport,
      modelLookup: options.modelLookup,
      runtimes,
      workspaces: options.workspaces,
      workspacePath: options.workspacePath,
      reuseLiveSession: options.reuseLiveSession,
      onLiveSessionResumed: options.onLiveSessionResumed,
    });
    this.turns = new TurnHandlers({
      sender: transport,
      runtimes,
      executor: options.runTurn,
      pump: options.pump,
      queue: options.queue,
      events: options.events,
      ensureServices: options.ensureServices,
      acceptRemoteText: options.acceptRemoteText,
    });
    this.interactions =
      options.interactions === false
        ? null
        : new InteractionBridge({
            sender: this.interactionSender(),
            runtimes,
            permissionManager: options.permissionManager,
            quizService: options.quizService,
            broker: options.interactionBroker,
            events: options.events,
            resolveSessionId:
              options.resolveSessionId ??
              (() => this.turns.getActiveSessionId()),
          });
    this.v4 = new V4Handlers({
      sender: transport,
      runtimes,
      sessions: this.sessions,
      turns: this.turns,
      interactionBroker: options.interactionBroker,
      interactions: this.interactions,
    });
    this.handlers.set(zcodeProtocolMethods.runtimeCapabilities, () =>
      this.capabilities(),
    );
    this.handlers.set(zcodeProtocolMethods.sessionLifecycleGetState, () =>
      this.registry.getState(),
    );
    this.handlers.set(zcodeProtocolMethods.sessionCreate, async (params) => {
      const input = parseParams(zcodeSessionCreateParamsSchema, params);
      if (input.model) {
        // A create that selects a model validates it, so the config and model
        // services must be up before the handler runs.
        await (options.ensureServices ?? ensureAppServerServices)();
      }
      const snapshot = await this.sessions.create(input);
      this.turns.registerSession(snapshot.session.sessionId);
      return snapshot;
    });
    this.handlers.set(zcodeProtocolMethods.sessionResume, async (params) => {
      const snapshot = await this.sessions.resume(params);
      this.turns.registerSession(snapshot.session.sessionId);
      return snapshot;
    });
    this.handlers.set(zcodeProtocolMethods.sessionList, (params) =>
      this.sessions.list(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionRead, (params) =>
      this.sessions.read(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionMessages, (params) =>
      this.sessions.messages(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionClose, (params) =>
      this.sessions.close(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionSend, (params) =>
      this.turns.send(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionSubscribe, (params) =>
      this.turns.subscribe(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionStop, (params) =>
      this.turns.stop(params),
    );
    this.handlers.set(zcodeProtocolMethods.sessionSetModel, async (params) => {
      const input = parseParams(zcodeSessionSetModelParamsSchema, params);
      await (options.ensureServices ?? ensureAppServerServices)();
      return this.sessions.setModel(input);
    });
    this.handlers.set(V4_METHODS.connectionFlow, () => ({}));
    this.handlers.set(V4_METHODS.conversationSubscribe, (params) =>
      this.v4.subscribe(params),
    );
    this.handlers.set(V4_METHODS.conversationUnsubscribe, (params) =>
      this.v4.unsubscribe(params),
    );
    this.handlers.set(V4_METHODS.conversationResync, (params) =>
      this.v4.resync(params),
    );
    this.handlers.set(V4_METHODS.command, (params) => this.v4.command(params));
  }

  dispose(): void {
    this.turns.dispose();
    this.v4.dispose();
    this.interactions?.dispose();
    for (const pending of this.serverRequests.values()) {
      pending.reject(new Error("App-server protocol disposed"));
    }
    this.serverRequests.clear();
  }

  async handle(message: unknown): Promise<void> {
    if (!isRecord(message)) {
      await this.sendError(
        null,
        PROTOCOL_INVALID_REQUEST,
        "Invalid request: expected an object",
      );
      return;
    }
    if (!Object.hasOwn(message, "id") || message.id === undefined) {
      return;
    }
    if (!isRequestId(message.id)) {
      await this.sendError(
        null,
        PROTOCOL_INVALID_REQUEST,
        "Invalid request id",
      );
      return;
    }
    // A message with no method but a result or error is the client answering a
    // request this server started (an interaction bridge prompt).
    if (!("method" in message) && ("result" in message || "error" in message)) {
      this.settleServerRequest(message);
      return;
    }
    if (typeof message.method !== "string") {
      await this.sendError(
        message.id,
        PROTOCOL_INVALID_REQUEST,
        "Invalid request: method must be a string",
      );
      return;
    }
    const handler = this.handlers.get(message.method);
    if (!handler) {
      await this.sendError(
        message.id,
        PROTOCOL_METHOD_NOT_FOUND,
        `Method not found: ${message.method}`,
      );
      return;
    }
    try {
      const result = await handler(message.params);
      await this.transport.send({ id: message.id, result: result ?? null });
    } catch (error) {
      await this.sendError(
        message.id,
        isSessionRequestError(error) ? error.code : PROTOCOL_INTERNAL_ERROR,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async handleMalformed(error: Error): Promise<void> {
    await this.sendError(
      null,
      PROTOCOL_PARSE_ERROR,
      `Parse error: ${error.message}`,
    );
  }

  private interactionSender(): InteractionSender {
    return {
      request: (method, params) => this.outboundRequest(method, params),
      respond: (requestId, result) => this.respondToClient(requestId, result),
    };
  }

  private outboundRequest(
    method: string,
    params: unknown,
  ): InteractionRequestHandle {
    this.nextServerRequestId += 1;
    const requestId = `app-server-${this.nextServerRequestId}`;
    const result = new Promise<unknown>((resolve, reject) => {
      this.serverRequests.set(requestId, { resolve, reject });
    });
    void this.transport
      .send({ id: requestId, method, params })
      .catch((error: unknown) => {
        this.rejectServerRequest(requestId, error);
      });
    return { requestId, result };
  }

  private respondToClient(requestId: string, result: unknown): Promise<void> {
    return this.transport.send({ id: requestId, result });
  }

  private rejectServerRequest(requestId: string, error: unknown): void {
    const pending = this.serverRequests.get(requestId);
    if (!pending) {
      return;
    }
    this.serverRequests.delete(requestId);
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private settleServerRequest(message: Record<string, unknown>): void {
    const requestId = String(message.id);
    const pending = this.serverRequests.get(requestId);
    if (!pending) {
      return;
    }
    this.serverRequests.delete(requestId);
    if (message.error !== undefined) {
      const record = isRecord(message.error) ? message.error : {};
      const text =
        typeof record.message === "string"
          ? record.message
          : `Interaction request ${requestId} failed`;
      pending.reject(new Error(text));
      return;
    }
    pending.resolve(message.result);
  }

  private async sendError(
    id: ProtocolRequestId,
    code: number,
    message: string,
  ): Promise<void> {
    await this.transport.send({ id, error: { code, message } });
  }

  private capabilities(): Record<string, unknown> {
    return {
      version: ZCODE_PROTOCOL_VERSION,
      capabilities: { version: ZCODE_PROTOCOL_VERSION },
    };
  }
}
