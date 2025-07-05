import {
  claimForToolCall,
  GLOBAL_SLOT,
  MAX_PARALLEL_READS,
} from "./concurrency.js";

export interface PlannedToolCall<T> {
  readonly call: T;
  readonly index: number;
  /**
   * Slots this call must hold while running. Empty means the call is
   * unserialized and may share a step with other unserialized calls.
   */
  readonly keys: readonly string[];
  /**
   * How many calls run in this call's step, passed through to tools that
   * divide their output budget by it.
   */
  readonly parallelCount: number;
}

export interface ExecutionStep<T> {
  /** Calls in this step run concurrently with each other. */
  readonly calls: readonly PlannedToolCall<T>[];
  /**
   * True when the step's calls must not start until the previous step has
   * finished. False when this step may overlap the previous one.
   */
  readonly barrier: boolean;
}

export interface ExecutionPlan<T> {
  readonly steps: readonly ExecutionStep<T>[];
  /** Flat view of every planned call, in original order. */
  readonly all: readonly PlannedToolCall<T>[];
}

/**
 * Orders a batch of tool calls for execution.
 *
 * The original order is preserved for two reasons. Tool results are assembled
 * back into the history by index, and some models are trained to emit calls
 * whose order carries meaning, such as a write followed by a read of that file.
 * So instead of sorting calls into buckets, this walks the batch once and
 * emits steps. Unserialized calls are gathered into the current step until the
 * read cap is reached; a call that claims a slot closes the current step and
 * starts a new one that waits behind it.
 *
 * A step is marked as a barrier when it contains a slot-claiming call. Because
 * steps run in order, that is enough to keep two edits to the same path apart
 * while still letting a run of reads overlap freely.
 */
export function planToolCalls<T extends { name: string; arguments: any }>(
  calls: readonly T[],
): ExecutionPlan<T> {
  const steps: ExecutionStep<T>[] = [];
  let current: PlannedToolCall<T>[] = [];
  let currentHasBarrier = false;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    steps.push({ calls: current, barrier: currentHasBarrier });
    current = [];
    currentHasBarrier = false;
  };

  calls.forEach((call, index) => {
    const claim = claimForToolCall(call.name, call.arguments);
    const keys = claim.exclusive ? [GLOBAL_SLOT] : claim.keys;

    if (keys.length === 0) {
      current.push({ call, index, keys, parallelCount: 1 });
      if (current.length >= MAX_PARALLEL_READS) {
        flush();
      }
      return;
    }

    // A slot-claiming call cannot share its step, so it ends the current one.
    flush();
    current.push({ call, index, keys, parallelCount: 1 });
    currentHasBarrier = true;
    flush();
  });

  flush();

  // The parallel count is a property of the step, not of the call, so it is
  // assigned once the grouping is final.
  const withCounts = steps.map((step) => {
    const size = step.calls.length;
    return {
      barrier: step.barrier,
      calls: step.calls.map((planned) => ({
        ...planned,
        parallelCount: size,
      })),
    };
  });

  const all = withCounts.flatMap((step) => step.calls);
  return { steps: withCounts, all };
}
