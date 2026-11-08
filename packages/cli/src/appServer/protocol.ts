import {
  zcodeSessionSetModelParamsSchema,
  ZCODE_PROTOCOL_VERSION,
  zcodeProtocolMethods,
} from "@zcode/shared";
import { V4_METHODS } from "@zcode/shared/zcode-protocol-v4";

import type { InteractionBroker } from "../permissions/interactionBroker.js";

import { SessionRuntimeStore } from "./runtime.js";
import {
  isSessionRequestError,
  parseParams,
  SessionHandlers,
  type ModelLookup,
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
  interactionBroker?: InteractionBroker;
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
  readonly sessions: SessionHandlers;
  readonly turns: TurnHandlers;
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
    });
    this.turns = new TurnHandlers({
      sender: transport,
      runtimes,
      executor: options.runTurn,
      pump: options.pump,
      queue: options.queue,
      events: options.events,
      ensureServices: options.ensureServices,
    });
    this.v4 = new V4Handlers({
      sender: transport,
      runtimes,
      sessions: this.sessions,
      turns: this.turns,
      interactionBroker: options.interactionBroker,
    });
    this.handlers.set(zcodeProtocolMethods.runtimeCapabilities, () =>
      this.capabilities(),
    );
    this.handlers.set(zcodeProtocolMethods.sessionLifecycleGetState, () =>
      this.registry.getState(),
    );
    this.handlers.set(zcodeProtocolMethods.sessionCreate, async (params) => {
      const snapshot = await this.sessions.create(params);
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
