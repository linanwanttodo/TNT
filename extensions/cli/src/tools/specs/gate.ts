import { logger } from "../../util/logger.js";

/**
 * Why a slot was released, so callers can distinguish an orderly run from one
 * that overran its wait.
 */
export type BarrierOutcome = "completed" | "timeout" | "aborted";

export interface BarrierRecord {
  readonly key: string;
  readonly outcome: BarrierOutcome;
  readonly waitedMs: number;
}

export type BarrierObserver = (record: BarrierRecord) => void;

export const DEFAULT_WRITE_BARRIER_TIMEOUT_MS = 2_000;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * Serializes tool execution without ever blocking forever.
 *
 * Each slot is a promise chain, so a caller waits for the previous holder and
 * then extends the chain. Waiting is bounded: a caller that exceeds its timeout
 * stops waiting and runs anyway. That keeps ordering intact for everyone behind
 * it while making a concurrent duplicate write recoverable, where a hard mutex
 * would turn a lost update into a hung turn.
 */
export class ExecutionGate {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly observers = new Set<BarrierObserver>();

  constructor(
    private readonly barrierTimeoutMs: number = DEFAULT_WRITE_BARRIER_TIMEOUT_MS,
  ) {}

  onBarrier(observer: BarrierObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Runs `task` holding every slot in `keys`. Keys are acquired in sorted
   * order so two callers claiming overlapping sets cannot deadlock.
   */
  async run<T>(
    keys: readonly string[],
    task: () => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    if (ordered.length === 0) {
      return task();
    }

    const releases: Array<() => void> = [];
    try {
      for (const key of ordered) {
        releases.push(
          await this.acquire(key, this.barrierTimeoutMs, options.signal),
        );
      }
    } catch (error) {
      for (const release of releases.reverse()) {
        release();
      }
      throw error;
    }

    try {
      return await task();
    } finally {
      for (const release of releases.reverse()) {
        release();
      }
    }
  }

  private async acquire(
    key: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<() => void> {
    const started = now();
    const predecessor = this.chains.get(key);

    // Extend the chain before waiting, so callers behind us queue on our
    // release rather than on the predecessor we are still waiting for.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const link = predecessor ? predecessor.then(() => held) : held;
    this.chains.set(key, link);

    const finish = () => {
      release();
      if (this.chains.get(key) === link) {
        this.chains.delete(key);
      }
    };

    if (predecessor === undefined) {
      return finish;
    }

    const outcome = await raceBarrier(predecessor, timeoutMs, signal);
    if (outcome !== "completed") {
      this.emit({ key, outcome, waitedMs: Math.round(now() - started) });
      logger.debug("Barrier wait cut short; proceeding anyway", {
        key,
        outcome,
        waitedMs: Math.round(now() - started),
      });
    }

    return finish;
  }

  private emit(record: BarrierRecord): void {
    for (const observer of this.observers) {
      try {
        observer(record);
      } catch (error) {
        logger.debug("Barrier observer threw", { error });
      }
    }
  }
}

async function raceBarrier(
  predecessor: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<BarrierOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer?.unref?.();
  });

  const aborted = signal
    ? new Promise<"aborted">((resolve) => {
        if (signal.aborted) {
          resolve("aborted");
          return;
        }
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
      })
    : null;

  try {
    const winner = await (aborted
      ? Promise.race([predecessor, timeout, aborted])
      : Promise.race([predecessor, timeout]));
    return winner === "aborted"
      ? "aborted"
      : winner === "timeout"
        ? "timeout"
        : "completed";
  } finally {
    clearTimeout(timer);
  }
}
