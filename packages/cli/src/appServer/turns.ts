import type { ModelSelection, ZCodeSessionStateSnapshot } from "@zcode/shared";
import {
  zcodeSessionSendParamsSchema,
  zcodeSessionStopParamsSchema,
  zcodeSessionSubscribeParamsSchema,
} from "@zcode/shared";
import type { Session } from "core/index.js";

import { subscribeAgentEvents } from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";
import {
  ensureServicesInitialized,
  getService,
  services,
  SERVICE_NAMES,
} from "../services/index.js";
import {
  turnRunnerService,
  type RunTurn,
} from "../services/TurnRunnerService.js";
import type { ModelServiceState } from "../services/types.js";
import { runAgentTurn } from "../session/controller.js";
import { loadSessionById, resumeSession } from "../session/index.js";
import { sessionStore } from "../session/store.js";
import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";
import type { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { logger } from "../utils/logger.js";

import type { SessionRuntimeStore } from "./runtime.js";
import { parseParams, sessionRequestError } from "./session.js";
import { toZcodeSnapshot } from "./snapshot.js";
import { applyTurnSelection, type TurnSelection } from "./turnSelection.js";

export interface TurnSender {
  send(message: unknown): Promise<void>;
}

export interface TurnQueue {
  enqueueMessage(message: string): Promise<boolean>;
  on(
    event: "messageQueued",
    listener: (message: QueuedMessage) => void,
  ): unknown;
  off(
    event: "messageQueued",
    listener: (message: QueuedMessage) => void,
  ): unknown;
}

export interface TurnPump {
  startDraining(runTurn?: RunTurn): void;
  isRunning(): boolean;
  requestStop(): void;
}

export interface PendingTurn extends TurnSelection {
  id: string;
  sessionId: string;
  text: string;
  compact: boolean;
}

export type TurnExecutor = (
  turn: PendingTurn,
  signal: AbortSignal,
) => Promise<void>;

export interface TurnSources {
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

export interface TurnHandlerOptions {
  sender: TurnSender;
  runtimes: SessionRuntimeStore;
  executor?: TurnExecutor;
  queue?: TurnQueue;
  pump?: TurnPump;
  events?: TurnSources;
  ensureServices?: () => Promise<void>;
}

export interface SessionSendResult {
  sessionId: string;
  accepted: true;
  stateRevision: number;
}

export interface SessionSubscribeResult {
  sessionId: string;
  eventSeq: number;
  events: ReturnType<SessionRuntimeStore["eventsAfter"]>;
  snapshot?: ZCodeSessionStateSnapshot;
}

function splitModelTitle(
  title: string | undefined,
): ModelSelection | undefined {
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
 * The strict send schema has no `thoughtLevel`; the agent service forwards one
 * when a host sets it. Pull it out before the strict parse so a known
 * extension does not reject the whole send.
 */
function splitThoughtLevel(params: unknown): {
  params: unknown;
  thoughtLevel?: string;
} {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { params };
  }
  if (!("thoughtLevel" in params)) {
    return { params };
  }
  const { thoughtLevel, ...rest } = params as Record<string, unknown>;
  const value = typeof thoughtLevel === "string" ? thoughtLevel.trim() : "";
  return {
    params: rest,
    ...(value.length > 0 ? { thoughtLevel: value } : {}),
  };
}

/**
 * The app-server process starts without the service container, so the first
 * turn (or setModel) brings config/model up through the same shared headless
 * initialization the serve daemon uses. `sessionStore` and the event bus are
 * process singletons and need no initialization.
 */
export function ensureAppServerServices(): Promise<void> {
  return ensureServicesInitialized();
}

function terminalEvent(
  runtimes: SessionRuntimeStore,
  sessionId: string,
  message: string,
): void {
  runtimes.append(
    sessionId,
    "turn.failed",
    {
      error: { type: "turn_error", message },
      turnPhase: "prepare",
    },
    Date.now(),
  );
}

/**
 * The headless turn path: the same `runAgentTurn` pipeline `serve`/`webui` use,
 * with the session selected explicitly rather than read from `getCurrentSession`.
 * No Ink, no TUI, and no `setDefaultRunTurn`: the drain loop is asked for a
 * runner only when no other surface registered one.
 */
export function createHeadlessExecutor(
  runtimes: SessionRuntimeStore,
  ensureServices: () => Promise<void> = ensureAppServerServices,
): TurnExecutor {
  return async (turn, signal): Promise<void> => {
    try {
      await ensureServices();
    } catch (error) {
      terminalEvent(
        runtimes,
        turn.sessionId,
        `Model services unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    let modelState = await getService<ModelServiceState>(SERVICE_NAMES.MODEL);
    if (!modelState.llmApi || !modelState.model) {
      terminalEvent(
        runtimes,
        turn.sessionId,
        "No chat model is configured for the app-server",
      );
      return;
    }
    const session =
      resumeSession(turn.sessionId) ?? loadSessionById(turn.sessionId);
    if (!session) {
      terminalEvent(
        runtimes,
        turn.sessionId,
        `Session not found: ${turn.sessionId}`,
      );
      return;
    }
    try {
      await applyTurnSelection(session, turn);
    } catch (error) {
      terminalEvent(
        runtimes,
        turn.sessionId,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    // A switch replaced the container's model state; run on what is live now.
    modelState = await getService<ModelServiceState>(SERVICE_NAMES.MODEL);
    if (!modelState.llmApi || !modelState.model) {
      terminalEvent(
        runtimes,
        turn.sessionId,
        "No chat model is configured for the app-server",
      );
      return;
    }
    try {
      await services.chatHistory.initialize(session, false);
    } catch (error) {
      logger.debug(
        "AppServer: chat history init failed; continuing on arrays",
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId: turn.sessionId,
        },
      );
    }
    const abortController = new AbortController();
    const onAbort = (): void => {
      abortController.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // Tool results are added to history by the stream itself; system notices
    // still need a sink. Everything the UI renders arrives as an AgentEvent.
    const callbacks: StreamCallbacks = {
      onSystemMessage: (message) => {
        try {
          services.chatHistory.addSystemMessage(message);
        } catch (error) {
          logger.debug("AppServer: system message failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
    try {
      if (turn.compact) {
        await runAgentTurn({
          chatHistory: services.chatHistory.getHistory(),
          model: modelState.model,
          llmApi: modelState.llmApi,
          abortController,
          callbacks,
          isCompacting: true,
          sessionId: turn.sessionId,
        });
      } else {
        services.chatHistory.addUserMessage(turn.text);
        await runAgentTurn({
          chatHistory: services.chatHistory.getHistory(),
          model: modelState.model,
          llmApi: modelState.llmApi,
          abortController,
          callbacks,
          sessionId: turn.sessionId,
        });
      }
      sessionStore.sync(session);
    } catch (error) {
      if (
        !abortController.signal.aborted &&
        !runtimes.hasTerminal(turn.sessionId)
      ) {
        terminalEvent(
          runtimes,
          turn.sessionId,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}

export class TurnHandlers {
  private readonly sender: TurnSender;
  private readonly runtimes: SessionRuntimeStore;
  private readonly queue: TurnQueue;
  private readonly pump: TurnPump;
  private readonly executor: TurnExecutor;
  private readonly unsubscribeBus: () => void;
  private readonly pending = new Map<string, PendingTurn>();
  private pendingInsert: Omit<PendingTurn, "id"> | null = null;
  private activeSessionId: string | null = null;
  private readonly sessionListeners = new Map<string, () => void>();

  constructor(options: TurnHandlerOptions) {
    this.sender = options.sender;
    this.runtimes = options.runtimes;
    this.queue = options.queue ?? messageQueue;
    this.pump = options.pump ?? turnRunnerService;
    this.executor =
      options.executor ??
      createHeadlessExecutor(this.runtimes, options.ensureServices);
    const eventSource = options.events ?? { subscribe: subscribeAgentEvents };
    this.unsubscribeBus = eventSource.subscribe((event) => {
      if (!this.runtimes.has(event.sessionId)) {
        return;
      }
      this.runtimes.applyAgentEvent(event);
    });
    this.queue.on("messageQueued", this.handleQueued);
  }

  registerSession(sessionId: string): void {
    this.runtimes.ensure(sessionId);
  }

  async send(params: unknown): Promise<SessionSendResult> {
    const split = splitThoughtLevel(params);
    const input = parseParams(zcodeSessionSendParamsSchema, split.params);
    this.requireSession(input.sessionId);
    const revision = await this.enqueue(input.sessionId, input.content, false, {
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(split.thoughtLevel ? { thoughtLevel: split.thoughtLevel } : {}),
    });
    return {
      sessionId: input.sessionId,
      accepted: true,
      stateRevision: revision,
    };
  }

  async subscribe(params: unknown): Promise<SessionSubscribeResult> {
    const input = parseParams(zcodeSessionSubscribeParamsSchema, params);
    const session = this.requireSession(input.sessionId);
    this.ensureSessionListener(input.sessionId);
    const cursor = this.runtimes.cursor(input.sessionId);
    const result: SessionSubscribeResult = {
      sessionId: input.sessionId,
      eventSeq: cursor.eventSeq,
      events: this.runtimes.eventsAfter(input.sessionId, input.afterSeq ?? 0),
    };
    if (input.includeSnapshot) {
      result.snapshot = toZcodeSnapshot(session, {
        meta: sessionStore.getMeta(input.sessionId),
        model: splitModelTitle(session.chatModelTitle ?? undefined),
        runtime: cursor,
        status: this.runtimes.isTurnActive(input.sessionId)
          ? "running"
          : "idle",
      });
    }
    return result;
  }

  async stop(params: unknown): Promise<Record<string, never>> {
    const input = parseParams(zcodeSessionStopParamsSchema, params);
    this.requireSession(input.sessionId);
    await this.stopSession(input.sessionId);
    return {};
  }

  async sendText(
    sessionId: string,
    text: string,
    selection: TurnSelection = {},
  ): Promise<number> {
    this.requireSession(sessionId);
    return this.enqueue(sessionId, text, false, selection);
  }

  async stopSession(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) {
      return;
    }
    this.pump.requestStop();
  }

  async compact(sessionId: string): Promise<number> {
    this.requireSession(sessionId);
    return this.enqueue(sessionId, "", true);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.requireSession(sessionId);
    sessionStore.delete(sessionId);
    this.runtimes.append(
      sessionId,
      "session.closed",
      { reason: "deleted" },
      Date.now(),
    );
  }

  isRunning(): boolean {
    return this.pump.isRunning();
  }

  /** The session whose turn is currently draining, if any. */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  dispose(): void {
    this.unsubscribeBus();
    this.queue.off("messageQueued", this.handleQueued);
    for (const unsubscribe of this.sessionListeners.values()) {
      unsubscribe();
    }
    this.sessionListeners.clear();
    this.pending.clear();
    this.pendingInsert = null;
    this.activeSessionId = null;
  }

  private readonly runQueuedTurn: RunTurn = async (
    queued,
    signal,
  ): Promise<void> => {
    const pending = this.pending.get(queued.id);
    if (!pending) {
      return;
    }
    this.pending.delete(queued.id);
    this.activeSessionId = pending.sessionId;
    try {
      await this.executor(pending, signal);
    } catch (error) {
      if (!this.runtimes.hasTerminal(pending.sessionId)) {
        terminalEvent(
          this.runtimes,
          pending.sessionId,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (this.activeSessionId === pending.sessionId) {
        this.activeSessionId = null;
      }
    }
  };

  private readonly handleQueued = (message: QueuedMessage): void => {
    const pending = this.pendingInsert;
    if (!pending) {
      return;
    }
    this.pendingInsert = null;
    this.pending.set(message.id, { ...pending, id: message.id });
  };

  private requireSession(sessionId: string): Session {
    const session = loadSessionById(sessionId);
    if (!session) {
      throw sessionRequestError(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private async enqueue(
    sessionId: string,
    text: string,
    compact: boolean,
    selection: TurnSelection = {},
  ): Promise<number> {
    this.runtimes.ensure(sessionId);
    const revision = this.runtimes.bumpRevision(sessionId);
    this.pendingInsert = { sessionId, text, compact, ...selection };
    await this.queue.enqueueMessage(text);
    this.pendingInsert = null;
    this.startTurn();
    return revision;
  }

  /**
   * Uses the drain loop that already exists (a TUI's default runner) instead of
   * replacing it; only a process with no pipeline installed gets this surface's
   * runner. That is what keeps the app-server from usurping a live TUI.
   */
  private startTurn(): void {
    if (this.pump.isRunning()) {
      return;
    }
    this.pump.startDraining();
    if (!this.pump.isRunning()) {
      this.pump.startDraining(this.runQueuedTurn);
    }
  }

  private ensureSessionListener(sessionId: string): void {
    if (this.sessionListeners.has(sessionId)) {
      return;
    }
    this.sessionListeners.set(
      sessionId,
      this.runtimes.subscribe(sessionId, (event) => {
        this.notify({ method: "session/event", params: event });
      }),
    );
  }

  private notify(message: unknown): void {
    this.sender.send(message).catch((error) => {
      logger.debug("AppServer: notification delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
