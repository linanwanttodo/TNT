/**
 * Classification of a round that ended for a reason other than a clean
 * finish.
 *
 * A turn can stop because the model decided it was done, or because the
 * provider, the network, or the model itself cut the round short. The second
 * case used to be indistinguishable from the first: the loop simply saw no
 * tool calls and ended, so a stalled stream looked exactly like a finished
 * task. These helpers name the difference so the loop can retry the round that
 * is worth retrying and stop on the one that is not.
 */

/**
 * Signals that a provider ended a stream before sending its terminal event.
 * Each pattern is a phrasing a real provider has used for the same underlying
 * fault, so the list is long on purpose: missing any one of them means a
 * stalled round gets reported as a completed task.
 */
const STREAM_STALL_PATTERNS: readonly RegExp[] = [
  /stream stall/i,
  /stream closed with error code\s+nghttp2_(?:internal_error|refused_stream)/i,
  /nghttp2_(?:internal_error|refused_stream)/i,
  /HTTP2(?:StreamReset|RefusedStream)/i,
];

/** Terminal events a provider is expected to send but sometimes omits. */
const MISSING_TERMINAL_EVENT_PATTERNS: readonly RegExp[] = [
  /missing\s+finish_reason/i,
  /terminal response event/i,
  /terminal completion event/i,
  /turnEnded/,
];

export type TerminalStopKind =
  /** The round completed normally. */
  | "ok"
  /** The provider cut the stream before its terminal event. */
  | "stream_stall"
  /** The provider sent an error that names a missing terminal event. */
  | "missing_terminal_event"
  /** The model returned nothing at all. */
  | "empty_response"
  /** The model returned a tool call that could not be parsed. */
  | "malformed_tool_call"
  /** A tool asked for the turn to end. */
  | "tool_stop";

/**
 * How many consecutive times one round kind may be retried within a single
 * user turn. Three keeps a fix-then-retry visible while stopping a fault that
 * is not going to resolve itself. Counters reset when the user sends a new
 * message, so a long session may hit the same fault repeatedly as long as it
 * is not stuck within one turn.
 */
export const MAX_RETRIES_PER_KIND = 3;

/**
 * Classify a thrown stream error.
 */
export function classifyStreamError(error: unknown): TerminalStopKind {
  const text = error instanceof Error ? error.message : String(error);

  if (STREAM_STALL_PATTERNS.some((pattern) => pattern.test(text))) {
    return "stream_stall";
  }
  if (MISSING_TERMINAL_EVENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return "missing_terminal_event";
  }
  return "ok";
}

/**
 * Whether a completed round is worth retrying. Only the two transport-level
 * kinds are: an empty response or a malformed tool call is a model decision,
 * and repeating the same request usually reproduces it.
 */
export function isRetryableStop(kind: TerminalStopKind): boolean {
  return kind === "stream_stall" || kind === "missing_terminal_event";
}

/**
 * Per-turn tally of retried round kinds. Each kind gets its own budget so a
 * flaky network does not consume the budget for a malformed tool call, and a
 * round that succeeds clears only its own kind.
 */
export class TerminalStopTracker {
  private readonly retries = new Map<TerminalStopKind, number>();

  /**
   * Record an occurrence and report whether the loop may retry this kind.
   * Returns false once the kind has exhausted its budget.
   */
  shouldRetry(kind: TerminalStopKind): boolean {
    if (!isRetryableStop(kind)) {
      return false;
    }

    const used = this.retries.get(kind) ?? 0;
    if (used >= MAX_RETRIES_PER_KIND) {
      return false;
    }

    this.retries.set(kind, used + 1);
    return true;
  }

  /** Retries already spent on a kind. */
  retriesUsed(kind: TerminalStopKind): number {
    return this.retries.get(kind) ?? 0;
  }

  /** A kind whose budget is exhausted, if any. */
  exhaustedKind(): TerminalStopKind | undefined {
    for (const [kind, used] of this.retries) {
      if (isRetryableStop(kind) && used >= MAX_RETRIES_PER_KIND) {
        return kind;
      }
    }
    return undefined;
  }

  /** Drop all tallies. A new user turn starts from zero. */
  resetForNewTurn(): void {
    this.retries.clear();
  }
}
