import type {
  CommandAck,
  CommandEnvelope,
} from "@zcode/shared/zcode-protocol-v4";
import {
  commandPayloadSchemas,
  parseCommandEnvelope,
  parseConversationTopic,
  V4_NOTIFICATIONS,
  v4ConversationResyncParamsSchema,
  v4ConversationSubscribeParamsSchema,
  v4ConversationUnsubscribeParamsSchema,
} from "@zcode/shared/zcode-protocol-v4";

import {
  interactionBroker as defaultBroker,
  type InteractionBroker,
} from "../permissions/interactionBroker.js";
import { loadSessionById } from "../session/index.js";
import { logger } from "../utils/logger.js";

import type { SessionRuntimeStore } from "./runtime.js";
import {
  parseParams,
  sessionRequestError,
  type SessionHandlers,
} from "./session.js";
import { deltasForEvent } from "./v4Deltas.js";
import {
  buildConversationFrame,
  buildConversationSnapshot,
  createFrameSubscription,
  type FrameSubscription,
} from "./v4Frames.js";

const METHOD_NOT_FOUND = -32601;

let subscriptionCounter = 0;

export interface V4Sender {
  send(message: unknown): Promise<void>;
}

export interface V4TurnTarget {
  sendText(sessionId: string, text: string): Promise<number>;
  compact(sessionId: string): Promise<number>;
  stopSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  isRunning(): boolean;
}

export interface V4HandlerOptions {
  sender: V4Sender;
  runtimes: SessionRuntimeStore;
  sessions: SessionHandlers;
  turns: V4TurnTarget;
  interactionBroker?: InteractionBroker;
}

interface SubscriptionRecord {
  readonly subscriptionId: string;
  readonly sessionId: string;
  readonly topic: string;
  readonly logEpoch: string;
  readonly frame: FrameSubscription;
  readonly unsubscribe: () => void;
}

function requireSessionId(envelope: CommandEnvelope): string {
  if (!envelope.sessionId) {
    throw sessionRequestError(`Command ${envelope.type} requires a sessionId`);
  }
  return envelope.sessionId;
}

export class V4Handlers {
  private readonly sender: V4Sender;
  private readonly runtimes: SessionRuntimeStore;
  private readonly sessions: SessionHandlers;
  private readonly turns: V4TurnTarget;
  private readonly broker: InteractionBroker;
  private readonly subscriptions = new Map<string, SubscriptionRecord>();

  constructor(options: V4HandlerOptions) {
    this.sender = options.sender;
    this.runtimes = options.runtimes;
    this.sessions = options.sessions;
    this.turns = options.turns;
    this.broker = options.interactionBroker ?? defaultBroker;
  }

  async subscribe(params: unknown): Promise<unknown> {
    const input = parseParams(v4ConversationSubscribeParamsSchema, params);
    const sessionId = parseConversationTopic(input.topic);
    if (!sessionId) {
      throw sessionRequestError(`Invalid conversation topic: ${input.topic}`);
    }
    const session = loadSessionById(sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${sessionId}`);
    }
    this.runtimes.ensure(sessionId);
    subscriptionCounter += 1;
    const subscriptionId = `sub-${subscriptionCounter}-${sessionId}`;
    const logEpoch = `epoch-${sessionId}`;
    const frame = createFrameSubscription(session, subscriptionId, logEpoch);
    const cursor = this.runtimes.cursor(sessionId);
    const unsubscribe = this.runtimes.subscribe(sessionId, (event) => {
      if (event.seq <= frame.lastFrameSeq) {
        return;
      }
      const deltas = deltasForEvent(frame, event);
      const wire = buildConversationFrame(
        frame,
        frame.lastFrameSeq,
        event.seq,
        { kind: "deltas", deltas },
        "online",
      );
      frame.lastFrameSeq = event.seq;
      this.notify(V4_NOTIFICATIONS.conversationFrame, wire);
    });
    this.subscriptions.set(subscriptionId, {
      subscriptionId,
      sessionId,
      topic: input.topic,
      logEpoch,
      frame,
      unsubscribe,
    });
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      cursor,
      this.turns.isRunning(),
    );
    const initial = buildConversationFrame(
      frame,
      0,
      cursor.eventSeq,
      { kind: "snapshot", snapshot },
      "initial",
    );
    frame.lastFrameSeq = cursor.eventSeq;
    await this.sender.send({
      method: V4_NOTIFICATIONS.conversationFrame,
      params: initial,
    });
    return { ack: { subscriptionId, mode: "snapshot", logEpoch } };
  }

  async unsubscribe(params: unknown): Promise<Record<string, never>> {
    const input = parseParams(v4ConversationUnsubscribeParamsSchema, params);
    const record = this.subscriptions.get(input.subscriptionId);
    if (record) {
      record.unsubscribe();
      this.subscriptions.delete(input.subscriptionId);
    }
    return {};
  }

  async resync(params: unknown): Promise<unknown> {
    const input = parseParams(v4ConversationResyncParamsSchema, params);
    const record = this.subscriptions.get(input.subscriptionId);
    if (!record) {
      throw sessionRequestError(
        `Unknown subscription: ${input.subscriptionId}`,
      );
    }
    const session = loadSessionById(record.sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${record.sessionId}`);
    }
    const cursor = this.runtimes.cursor(record.sessionId);
    const snapshot = buildConversationSnapshot(
      session,
      record.frame,
      cursor,
      this.turns.isRunning(),
    );
    const wire = buildConversationFrame(
      record.frame,
      0,
      cursor.eventSeq,
      { kind: "snapshot", snapshot },
      "recovery",
    );
    record.frame.lastFrameSeq = cursor.eventSeq;
    await this.sender.send({
      method: V4_NOTIFICATIONS.conversationFrame,
      params: wire,
    });
    return {
      ack: {
        subscriptionId: record.subscriptionId,
        mode: "snapshot",
        logEpoch: record.logEpoch,
      },
    };
  }

  async command(params: unknown): Promise<CommandAck> {
    const parsed = parseCommandEnvelope(params);
    if (!parsed.ok) {
      throw sessionRequestError(
        `Invalid command: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const envelope = parsed.envelope;
    switch (envelope.type) {
      case "sendText":
        return this.sendText(envelope);
      case "stop":
        return this.stop(envelope);
      case "compact":
        return this.compact(envelope);
      case "renameSession":
        return this.renameSession(envelope);
      case "deleteSession":
        return this.deleteSession(envelope);
      case "resolveInteraction":
        return this.resolveInteraction(envelope);
      default:
        throw sessionRequestError(
          `Unsupported command: ${envelope.type}`,
          METHOD_NOT_FOUND,
        );
    }
  }

  dispose(): void {
    for (const record of this.subscriptions.values()) {
      record.unsubscribe();
    }
    this.subscriptions.clear();
  }

  private async sendText(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    const payload = commandPayloadSchemas.sendText.parse(envelope.payload);
    const revision = await this.turns.sendText(sessionId, payload.text);
    return this.accepted(envelope, revision, {
      type: "inputAccepted",
      delivery: this.turns.isRunning() ? "queue" : "startNow",
      inputId: envelope.commandId,
    });
  }

  private async stop(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    await this.turns.stopSession(sessionId);
    return this.accepted(
      envelope,
      this.runtimes.cursor(sessionId).stateRevision,
    );
  }

  private async compact(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    commandPayloadSchemas.compact.parse(envelope.payload);
    const revision = await this.turns.compact(sessionId);
    return this.accepted(envelope, revision);
  }

  private async renameSession(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    const payload = commandPayloadSchemas.renameSession.parse(envelope.payload);
    await this.sessions.setTitle(sessionId, payload.title, "custom");
    return this.accepted(
      envelope,
      this.runtimes.cursor(sessionId).stateRevision,
    );
  }

  private async deleteSession(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    const revision = this.runtimes.cursor(sessionId).stateRevision;
    await this.turns.deleteSession(sessionId);
    return this.accepted(envelope, revision);
  }

  private async resolveInteraction(
    envelope: CommandEnvelope,
  ): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    const payload = commandPayloadSchemas.resolveInteraction.parse(
      envelope.payload,
    );
    const { interactionId, answer } = payload;
    let resolved = false;
    if (answer.action === "accept") {
      resolved = this.broker.approve(interactionId, false);
    } else if (answer.action === "decline" || answer.action === "cancel") {
      resolved = this.broker.reject(interactionId);
    } else {
      const value = answer.freeText ?? answer.optionId;
      if (value !== undefined) {
        resolved = this.broker.answerQuestion(interactionId, value);
      }
      if (!resolved && answer.optionId === "allow") {
        resolved = this.broker.approve(interactionId, false);
      }
      if (!resolved) {
        resolved = this.broker.reject(interactionId);
      }
    }
    const revision = this.runtimes.cursor(sessionId).stateRevision;
    if (!resolved) {
      return {
        commandId: envelope.commandId,
        status: "noop",
        reasonCode: "proto.alreadyResolved",
        revisionAtDecision: revision,
      };
    }
    return this.accepted(envelope, revision, {
      type: "resolveInteraction",
      resolvedBy: {
        clientId: envelope.clientId,
        ...(answer.optionId ? { optionId: answer.optionId } : {}),
      },
    });
  }

  private accepted(
    envelope: CommandEnvelope,
    revision: number,
    result?: CommandAck["result"],
  ): CommandAck {
    return {
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: revision,
      ...(result ? { result } : {}),
    };
  }

  private notify(method: string, params: unknown): void {
    this.sender.send({ method, params }).catch((error) => {
      logger.debug("AppServer: v4 frame delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
