/* eslint-disable max-lines -- the appServer protocol handlers share one ordered state machine */
import type { ModelSelection, ZCodeSessionStateSnapshot } from "@zcode/shared";
import {
  zcodeSessionSendParamsSchema,
  zcodeSessionStopParamsSchema,
  zcodeSessionSubscribeParamsSchema,
} from "@zcode/shared";
import type { Session } from "core/index.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
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
  /**
   * The browser host runs several conversations at once: each session owns a
   * serial chain and different sessions run in parallel. Off keeps the
   * process-wide pump path for the TUI and the legacy app-server tests.
   */
  concurrentSessions?: boolean;
  /**
   * A live TUI runtime shares this process: the browser's words join the
   * conversation the screen is running instead of starting a second headless
   * engine. Returns false when no runtime is bound and the queue should own
   * the text.
   */
  acceptRemoteText?: (text: string) => Promise<boolean>;
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
/**
 * Auto-title: after the first completed exchange, give an untitled session a
 * generated (LLM) or first-input title. The webui tab and the sidebar
 * otherwise keep the generic default forever. Mirrors the TUI's
 * generateSessionTitle but session-scoped, and emits the same
 * `session.titleUpdated` channel setTitle uses so every surface updates.
 */
async function autoTitleSession(
  session: Session,
  firstUserText: string,
  modelState: ModelServiceState,
  runtimes: SessionRuntimeStore,
): Promise<void> {
  try {
    if (session.title && session.title !== DEFAULT_SESSION_TITLE) return;
    const trimmedInput = firstUserText.replace(/\s+/g, " ").trim();
    if (!trimmedInput) return;
    let generated: string | undefined;
    if (modelState.llmApi && modelState.model) {
      try {
        const { ChatDescriber } = await import("core/util/chatDescriber.js");
        generated = await ChatDescriber.describeWithBaseLlmApi(
          modelState.llmApi,
          modelState.model,
          trimmedInput,
        );
      } catch (error) {
        logger.debug("AppServer: title generation failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const title =
      (generated ?? "").replace(/\s+/g, " ").trim().slice(0, 60) ||
      trimmedInput.slice(0, 40);
    if (!title || title === session.title) return;
    const previousTitle = session.title;
    session.title = title;
    sessionStore.sync(session);
    runtimes.append(session.sessionId, "session.titleUpdated", {
      previousTitle,
      title,
      source: generated ? "generated" : "first_input",
    });
  } catch (error) {
    logger.debug("AppServer: auto-title failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
      await autoTitleSession(session, turn.text, modelState, runtimes);
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
  private readonly acceptRemoteText:
    ((text: string) => Promise<boolean>) | undefined;
  private readonly executor: TurnExecutor;
  private readonly unsubscribeBus: () => void;
  private readonly pending = new Map<string, PendingTurn>();
  private pendingInsert: Omit<PendingTurn, "id"> | null = null;
  private activeSessionId: string | null = null;
  private readonly concurrentSessions: boolean;
  /** Per-session serial chains: same session stays ordered, others run now. */
  private readonly sessionChains = new Map<string, Promise<void>>();
  /** The in-flight controller of each session, for a precise stop. */
  private readonly sessionControllers = new Map<string, AbortController>();
  private sessionTurnCounter = 0;
  private readonly sessionListeners = new Map<string, () => void>();

  constructor(options: TurnHandlerOptions) {
    this.sender = options.sender;
    this.runtimes = options.runtimes;
    this.queue = options.queue ?? messageQueue;
    this.pump = options.pump ?? turnRunnerService;
    this.acceptRemoteText = options.acceptRemoteText;
    this.concurrentSessions = options.concurrentSessions === true;
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
    // The live runtime owns the turn regardless of which id the browser
    // still holds: a stale id after a directory switch must not fork the
    // conversation into a second engine.
    if (this.acceptRemoteText) {
      const handled = await this.acceptRemoteText(input.content);
      if (handled) {
        return {
          sessionId: input.sessionId,
          accepted: true,
          stateRevision: this.runtimes.cursor(input.sessionId).stateRevision,
        };
      }
    }
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
    // A browser can hold a stale or workspace-scoped id after a directory
    // switch. When this engine has one turn in flight, resolve the request to
    // that turn before requireSession rejects an id it no longer knows.
    const active = this.getActiveSessionId();
    if (active && !this.runtimes.has(input.sessionId)) {
      await this.stopSession(active);
      return {};
    }
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
    if (this.concurrentSessions) {
      // Only the addressed conversation is interrupted; the other sessions
      // keep running. Stale ids simply find no controller and do nothing.
      this.sessionControllers.get(sessionId)?.abort();
      return;
    }
    // One process runs at most one turn at a time. A browser can send a stale
    // or workspace-scoped sessionId (a directory switch, a resumed task); when
    // a turn is in flight, stopping it is the only meaningful action. With no
    // active turn of its own this engine stays idle, so another workspace's
    // in-flight turn is never stopped by a request addressed elsewhere.
    if (this.activeSessionId !== sessionId && !this.activeSessionId) {
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
    this.sessionControllers.get(sessionId)?.abort();
    sessionStore.delete(sessionId);
    this.runtimes.append(
      sessionId,
      "session.closed",
      { reason: "deleted" },
      Date.now(),
    );
  }

  /** True when any turn is running, or only for the named session in concurrent mode. */
  isRunning(sessionId?: string): boolean {
    if (this.concurrentSessions) {
      // A queued follow-up in the same session counts as busy: the chain has
      // work to drain even before its turn starts.
      return sessionId
        ? this.sessionChains.has(sessionId)
        : this.sessionChains.size > 0;
    }
    return this.pump.isRunning();
  }

  /** A session whose turn is currently draining, if any. */
  getActiveSessionId(): string | null {
    if (this.concurrentSessions) {
      return this.sessionControllers.keys().next().value ?? null;
    }
    return this.activeSessionId;
  }

  /** Whether the named session has a turn in flight (concurrent host). */
  isSessionRunning(sessionId: string): boolean {
    return this.sessionControllers.has(sessionId);
  }

  dispose(): void {
    this.unsubscribeBus();
    this.queue.off("messageQueued", this.handleQueued);
    for (const unsubscribe of this.sessionListeners.values()) {
      unsubscribe();
    }
    this.sessionListeners.clear();
    for (const controller of this.sessionControllers.values()) {
      controller.abort();
    }
    this.sessionControllers.clear();
    this.sessionChains.clear();
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
    if (this.concurrentSessions) {
      this.scheduleSessionTurn({
        id: `session-turn-${++this.sessionTurnCounter}`,
        sessionId,
        text,
        compact,
        ...selection,
      });
      return revision;
    }
    this.pendingInsert = { sessionId, text, compact, ...selection };
    await this.queue.enqueueMessage(text);
    this.pendingInsert = null;
    this.startTurn();
    return revision;
  }

  /**
   * One serial chain per session. The chain is the ordering authority: a new
   * message for the same conversation waits behind the current turn, while a
   * different conversation starts immediately on its own chain. Each in-flight
   * turn owns its controller so Stop cannot interrupt a sibling session.
   */
  private scheduleSessionTurn(pending: PendingTurn): void {
    const previous =
      this.sessionChains.get(pending.sessionId) ?? Promise.resolve();
    const chain = previous
      .catch(() => undefined)
      .then(async () => {
        // Register only when this turn actually starts, so a queued sibling
        // cannot overwrite the controller of the turn already in flight.
        const controller = new AbortController();
        this.sessionControllers.set(pending.sessionId, controller);
        try {
          await this.executor(pending, controller.signal);
        } catch (error) {
          if (!this.runtimes.hasTerminal(pending.sessionId)) {
            terminalEvent(
              this.runtimes,
              pending.sessionId,
              error instanceof Error ? error.message : String(error),
            );
          }
        } finally {
          if (this.sessionControllers.get(pending.sessionId) === controller) {
            this.sessionControllers.delete(pending.sessionId);
          }
        }
      });
    this.sessionChains.set(pending.sessionId, chain);
    void chain.finally(() => {
      if (this.sessionChains.get(pending.sessionId) === chain) {
        this.sessionChains.delete(pending.sessionId);
      }
    });
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
