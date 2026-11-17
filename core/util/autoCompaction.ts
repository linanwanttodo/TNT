/**
 * Decides when a conversation should compact itself, and when to stop trying.
 *
 * Compacting costs a full model round trip, so it should happen before the
 * window is exhausted rather than after messages start being dropped. The
 * threshold leaves a buffer below the limit for the summary request itself.
 */

/**
 * Fraction of the usable window at which auto-compaction triggers. Chosen so
 * the summary request still has room to run before the window is full.
 */
export const AUTO_COMPACTION_THRESHOLD = 0.8;

/**
 * After this many consecutive failures, stop attempting auto-compaction for
 * the session. A context that cannot be compacted (for example because the
 * request itself is rejected) would otherwise retry on every turn forever.
 */
export const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3;

/**
 * After this many consecutive compactions that bought nothing, stop too.
 *
 * A summarization that does not shrink the history is an ordinary outcome and
 * must not count as a failure. But when it keeps happening, the trigger is
 * unreachable: what remains after compaction - the fixed system message and
 * tool schemas plus the retained tail - is already past the threshold, so every
 * later round summarizes again, pays for it, and throws the result away. That
 * is a loop, not an outcome, and it costs a model call per round.
 */
export const MAX_CONSECUTIVE_COMPACTION_NO_PROGRESS = 3;

export interface AutoCompactionState {
  consecutiveFailures: number;
  /** Consecutive compactions that ran but did not reduce the history. */
  consecutiveNoProgress: number;
  /** Whether a compaction attempt is currently in flight. */
  inFlight: boolean;
}

export function createAutoCompactionState(): AutoCompactionState {
  return { consecutiveFailures: 0, consecutiveNoProgress: 0, inFlight: false };
}

/**
 * Returns true when the conversation is close enough to the context limit that
 * it should compact before the next request.
 */
export function shouldAutoCompact(
  contextPercentage: number | undefined,
  state: AutoCompactionState,
): boolean {
  if (state.inFlight) {
    return false;
  }
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_COMPACTION_FAILURES) {
    return false;
  }
  if (contextPercentage === undefined || !Number.isFinite(contextPercentage)) {
    return false;
  }
  return contextPercentage >= AUTO_COMPACTION_THRESHOLD;
}

export function recordCompactionSuccess(
  state: AutoCompactionState,
): AutoCompactionState {
  return {
    ...state,
    inFlight: false,
    consecutiveFailures: 0,
    consecutiveNoProgress: 0,
  };
}

export function recordCompactionFailure(
  state: AutoCompactionState,
): AutoCompactionState {
  return {
    ...state,
    inFlight: false,
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

/**
 * A summarization that ran and changed nothing. It is not a failure, but the
 * repeat count is what stops a trigger the history cannot get under.
 */
export function recordCompactionNoProgress(
  state: AutoCompactionState,
): AutoCompactionState {
  return {
    ...state,
    inFlight: false,
    consecutiveFailures: 0,
    consecutiveNoProgress: state.consecutiveNoProgress + 1,
  };
}

/** True once the breaker has tripped and auto-compaction is disabled. */
export function isCompactionBreakerTripped(
  state: AutoCompactionState,
): boolean {
  return (
    state.consecutiveFailures >= MAX_CONSECUTIVE_COMPACTION_FAILURES ||
    state.consecutiveNoProgress >= MAX_CONSECUTIVE_COMPACTION_NO_PROGRESS
  );
}
