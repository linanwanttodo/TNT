import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";
import { logger } from "../utils/logger.js";

export type RunTurn = (
  message: QueuedMessage,
  signal: AbortSignal,
) => Promise<void>;

interface TurnRunnerOptions {
  pollIntervalMs: number;
  idleTimeoutMs: number;
}

const DEFAULT_OPTIONS: TurnRunnerOptions = {
  pollIntervalMs: 150,
  idleTimeoutMs: 10_000,
};

/**
 * Process-wide arbitration over who runs the agent turn loop.
 *
 * Any surface (TUI, serve, a future web UI) enqueues onto messageQueue and
 * calls startDraining; exactly one drain loop consumes it, so two surfaces
 * can never drive the engine at the same time. The loop wakes on the queue's
 * "messageQueued" event and falls back to polling, and exits after a stretch
 * of idleness so an idle process holds no live loop.
 */
export class TurnRunnerService {
  private options: TurnRunnerOptions;
  private draining = false;
  private currentAbortController: AbortController | null = null;
  private stopListeners = new Set<() => void>();

  constructor(options: Partial<TurnRunnerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Starts the drain loop unless one is already running (idempotent). */
  startDraining(runTurn: RunTurn): void {
    if (this.draining) {
      logger.debug("TurnRunner: drain loop already running");
      return;
    }

    this.draining = true;
    void this.drainLoop(runTurn);
  }

  /**
   * Registers a callback for stop requests from other surfaces, so a surface
   * whose interrupt lives outside this controller (the TUI) can truncate its
   * in-flight turn too. Returns an unsubscribe function.
   */
  onStopRequest(listener: () => void): () => void {
    this.stopListeners.add(listener);
    return () => {
      this.stopListeners.delete(listener);
    };
  }

  /** Aborts the turn in flight and notifies stop listeners; no-op when idle. */
  requestStop(): void {
    this.currentAbortController?.abort();
    for (const listener of this.stopListeners) {
      listener();
    }
  }

  isRunning(): boolean {
    return this.draining;
  }

  private async drainLoop(runTurn: RunTurn): Promise<void> {
    try {
      while (this.draining) {
        const message = await this.waitForMessage();
        if (!message) {
          break;
        }

        const abortController = new AbortController();
        this.currentAbortController = abortController;
        try {
          await runTurn(message, abortController.signal);
        } catch (error) {
          // An abort is Stop reaching a live turn, not a failure; anything
          // else is logged and the queue moves on.
          if (!abortController.signal.aborted) {
            logger.error("TurnRunner: runTurn failed", error);
          }
        } finally {
          this.currentAbortController = null;
        }
      }
    } finally {
      this.draining = false;
      this.currentAbortController = null;
    }
  }

  private waitForMessage(): Promise<QueuedMessage | undefined> {
    const immediate = messageQueue.getNextMessage();
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return new Promise((resolve) => {
      const settle = (message: QueuedMessage | undefined) => {
        messageQueue.removeListener("messageQueued", onQueued);
        clearInterval(pollTimer);
        clearTimeout(idleTimer);
        resolve(message);
      };

      const onQueued = () => {
        const next = messageQueue.getNextMessage();
        if (next) {
          settle(next);
        }
      };

      messageQueue.on("messageQueued", onQueued);
      const pollTimer: ReturnType<typeof setInterval> = setInterval(() => {
        const next = messageQueue.getNextMessage();
        if (next) {
          settle(next);
        }
      }, this.options.pollIntervalMs);
      const idleTimer: ReturnType<typeof setTimeout> = setTimeout(
        () => settle(undefined),
        this.options.idleTimeoutMs,
      );
    });
  }
}

export const turnRunnerService = new TurnRunnerService();
