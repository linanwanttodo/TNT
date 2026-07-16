import type {
  CommandAck,
  CommandEnvelope,
} from "@zcode/shared/zcode-protocol-v4";
import {
  commandPayloadSchemas,
  clampWorkflowRunsForLegacy,
  parseCommandEnvelope,
  parseConversationTopic,
  V4_NOTIFICATIONS,
  v4ConversationResyncParamsSchema,
  v4ConversationSubscribeParamsSchema,
  v4ConversationUnsubscribeParamsSchema,
} from "@zcode/shared/zcode-protocol-v4";
import type { TeamRunRecord } from "core/index.js";

import {
  interactionBroker as defaultBroker,
  type InteractionBroker,
} from "../permissions/interactionBroker.js";
import { loadSessionById, subscribeTeamRunChanges } from "../session/index.js";
import { sessionStore } from "../session/store.js";
import { logger } from "../utils/logger.js";

import type { InteractionBridge } from "./interactions.js";
import type { SessionRuntimeStore } from "./runtime.js";
import {
  parseParams,
  sessionRequestError,
  type SessionHandlers,
} from "./session.js";
import type { TurnSelection } from "./turnSelection.js";
import { deltasForEvent } from "./v4Deltas.js";
import {
  buildConversationFrame,
  buildConversationSnapshot,
  createFrameSubscription,
  derivePendingInteractions,
  type FrameSubscription,
} from "./v4Frames.js";
import {
  buildWorkflowRunDeltas,
  teamRunsToWorkflowRuns,
  teamRunWorkflowDisplay,
} from "./workflowRuns.js";

const METHOD_NOT_FOUND = -32601;

let subscriptionCounter = 0;

export interface V4Sender {
  send(message: unknown): Promise<void>;
}

export interface V4TurnTarget {
  sendText(
    sessionId: string,
    text: string,
    selection?: TurnSelection,
  ): Promise<number>;
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
  interactions?: InteractionBridge | null;
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
  private readonly interactions: InteractionBridge | null;
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly teamRunsBySession = new Map<string, TeamRunRecord[]>();
  private readonly unsubscribeTeamRuns: () => void;

  constructor(options: V4HandlerOptions) {
    this.sender = options.sender;
    this.runtimes = options.runtimes;
    this.sessions = options.sessions;
    this.turns = options.turns;
    this.broker = options.interactionBroker ?? defaultBroker;
    this.interactions = options.interactions ?? null;
    this.unsubscribeTeamRuns = subscribeTeamRunChanges((sessionId, runs) =>
      this.teamRunsChanged(sessionId, runs),
    );
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
    this.teamRunsBySession.set(sessionId, session.teamRuns ?? []);
    subscriptionCounter += 1;
    const subscriptionId = `sub-${subscriptionCounter}-${sessionId}`;
    const logEpoch = `epoch-${sessionId}`;
    const frame = createFrameSubscription(
      session,
      subscriptionId,
      logEpoch,
      input.workflowRunDeltas === true,
    );
    const cursor = this.runtimes.cursor(sessionId);
    const unsubscribe = this.runtimes.subscribe(sessionId, (event) => {
      if (event.seq <= frame.lastFrameSeq) {
        return;
      }
      const deltas = deltasForEvent(frame, event, {
        teamRuns: this.teamRunsBySession.get(sessionId),
      });
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
      derivePendingInteractions(
        this.runtimes.eventsAfter(sessionId, 0),
        frame.rows,
      ),
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
      derivePendingInteractions(
        this.runtimes.eventsAfter(record.sessionId, 0),
        record.frame.rows,
      ),
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
      case "createSession":
        return this.createSession(envelope);
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
    this.unsubscribeTeamRuns();
    for (const record of this.subscriptions.values()) {
      record.unsubscribe();
    }
    this.subscriptions.clear();
  }

  /**
   * One ledger mutation becomes one `session.updated` event carrying the run
   * deltas (and, when a run first opens, the static graph for the SummonTeam
   * row). Appending the event is what advances the conversation seq, so the
   * client applies it like any other frame instead of re-reading state.
   */
  private teamRunsChanged(sessionId: string, runs: TeamRunRecord[]): void {
    const previous = this.teamRunsBySession.get(sessionId);
    const previousIds = new Set((previous ?? []).map((run) => run.runId));
    const newest = runs[runs.length - 1];
    const newRun =
      newest !== undefined && !previousIds.has(newest.runId)
        ? newest
        : undefined;
    this.teamRunsBySession.set(sessionId, runs);

    const candidate = this.runtimes.workflowRevision(sessionId) + 1;
    const deltas = buildWorkflowRunDeltas(previous, runs, candidate);
    if (deltas.length === 0 && newRun === undefined) {
      return;
    }
    this.runtimes.bumpWorkflowRevision(sessionId);

    const payload: Record<string, unknown> = {};
    if (deltas.length > 0) {
      payload.workflowRunDeltas = deltas;
      // Capable subscribers consume the deltas. A subscriber that did not
      // declare the capability sees this whole key instead, already clamped to
      // the legacy actor/node bounds.
      payload.workflowRuns = clampWorkflowRunsForLegacy(
        teamRunsToWorkflowRuns(runs, this.runtimes.workflowRevision(sessionId)),
      );
    }
    if (newRun) {
      const toolCallId =
        this.runtimes.ensure(sessionId).state.summonTeamToolCallId;
      if (toolCallId) {
        payload.teamWorkflowDisplay = {
          toolCallId,
          display: teamRunWorkflowDisplay(newRun, newRun.status !== "failed"),
        };
      }
    }
    this.runtimes.append(sessionId, "session.updated", payload);
  }

  private async createSession(envelope: CommandEnvelope): Promise<CommandAck> {
    const payload = commandPayloadSchemas.createSession.parse(envelope.payload);
    const session = await this.sessions.createDraft({
      workspacePath: payload.workspaceId,
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      ...(payload.config ? { config: payload.config } : {}),
    });
    this.runtimes.ensure(session.sessionId);
    if (!payload.firstInput) {
      return this.accepted(
        envelope,
        this.runtimes.cursor(session.sessionId).stateRevision,
        { type: "createSession", sessionId: session.sessionId },
      );
    }
    // The session was created on the request's config, so the first turn runs
    // on that selection unless the input overrides it.
    const selection =
      payload.firstInput.modelSelection ??
      payload.config?.modelSelection ??
      (payload.config?.provider && payload.config.model
        ? {
            providerId: payload.config.provider,
            modelId: payload.config.model,
          }
        : undefined);
    const revision = await this.turns.sendText(
      session.sessionId,
      payload.firstInput.text,
      selection ? { modelSelection: selection } : {},
    );
    return this.accepted(envelope, revision, {
      type: "createSession",
      sessionId: session.sessionId,
      input: {
        delivery: this.turns.isRunning() ? "queue" : "startNow",
        inputId: envelope.commandId,
      },
    });
  }

  private async sendText(envelope: CommandEnvelope): Promise<CommandAck> {
    const sessionId = requireSessionId(envelope);
    const payload = commandPayloadSchemas.sendText.parse(envelope.payload);
    const revision = await this.turns.sendText(sessionId, payload.text, {
      ...(payload.modelSelection
        ? { modelSelection: payload.modelSelection }
        : {}),
    });
    // The first input turns a draft into a real task: persist the header
    // before the ACK so a tree read right after it lists the row.
    const session = loadSessionById(sessionId);
    if (session && sessionStore.getMeta(sessionId) === null) {
      sessionStore.sync(session);
    }
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
    const resolved = this.interactions
      ? this.interactions.resolveInteraction(interactionId, answer)
      : this.resolveInteractionLegacy(interactionId, answer);
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

  private resolveInteractionLegacy(
    interactionId: string,
    answer: {
      optionId?: string;
      freeText?: string;
      action?: "accept" | "decline" | "cancel";
    },
  ): boolean {
    if (answer.action === "accept") {
      return this.broker.approve(interactionId, false);
    }
    if (answer.action === "decline" || answer.action === "cancel") {
      return this.broker.reject(interactionId);
    }
    const value = answer.freeText ?? answer.optionId;
    if (
      value !== undefined &&
      this.broker.answerQuestion(interactionId, value)
    ) {
      return true;
    }
    if (answer.optionId === "allow") {
      return this.broker.approve(interactionId, false);
    }
    return this.broker.reject(interactionId);
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
