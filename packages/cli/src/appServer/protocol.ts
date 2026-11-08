import { ZCODE_PROTOCOL_VERSION, zcodeProtocolMethods } from "@zcode/shared";

import type { SessionRegistry } from "./sessionRegistry.js";

export const PROTOCOL_PARSE_ERROR = -32700;
export const PROTOCOL_INVALID_REQUEST = -32600;
export const PROTOCOL_METHOD_NOT_FOUND = -32601;
export const PROTOCOL_INTERNAL_ERROR = -32603;

export type ProtocolRequestId = string | number | null;

export interface ProtocolSender {
  send(message: unknown): Promise<void>;
}

export type ProtocolHandler = (params: unknown) => unknown | Promise<unknown>;

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

  constructor(
    private readonly transport: ProtocolSender,
    private readonly registry: SessionRegistry,
  ) {
    this.handlers.set(zcodeProtocolMethods.runtimeCapabilities, () =>
      this.capabilities(),
    );
    this.handlers.set(zcodeProtocolMethods.sessionLifecycleGetState, () =>
      this.registry.getState(),
    );
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
      await this.transport.send({ id: message.id, result });
    } catch (error) {
      await this.sendError(
        message.id,
        PROTOCOL_INTERNAL_ERROR,
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
