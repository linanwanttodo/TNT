/**
 * Why a conversation turn ended.
 *
 * The loop used to be able to stop only when the model declined to call a
 * tool, so every caller had to infer the reason from the shape of the output.
 * Naming the reason lets the UI, headless mode, and the review worker report
 * a truncated turn honestly instead of showing a partial answer as a finished
 * one.
 */

export type TerminationReason =
  /** The model replied without requesting tools. The ordinary ending. */
  | "no_tool_calls"
  /** The user aborted, or the abort signal fired. */
  | "user_abort"
  /** The round ceiling was reached. */
  | "max_steps"
  /** Enough consecutive rounds produced no effective new content. */
  | "diminishing_returns"
  /** Automatic compaction failed too many times in a row. */
  | "compaction_circuit_open"
  /** The stream kept ending early and retrying no longer helped. */
  | "stream_stall"
  /** The context window cannot be recovered by compaction. */
  | "context_unrecoverable"
  /** Output repeated itself in a way that indicates a loop. */
  | "loop_detected"
  /** A caller-supplied hook asked for the turn to end. */
  | "hook_stop"
  /** A tool signalled that the turn should not continue. */
  | "tool_stop"
  /** The caller's wall-clock bound on the request expired. */
  | "request_timeout";

/**
 * What `armTimeout` aborts with, so the loop can tell a deadline from a person
 * pressing Ctrl+C. It lives here because both ends already import this module.
 */
export const REQUEST_TIMEOUT_ABORT = Symbol("tnt request timeout");

/** Terminal states that are not truncations. */
const NORMAL_ENDINGS: ReadonlySet<TerminationReason> = new Set([
  "no_tool_calls",
  "user_abort",
  "hook_stop",
  "tool_stop",
]);

/**
 * Whether the turn completed on purpose. A truncated turn still has usable
 * output, but callers should surface that it was cut short.
 */
export function isNormalTermination(reason: TerminationReason): boolean {
  return NORMAL_ENDINGS.has(reason);
}

/**
 * One-line explanation for the user, phrased for a person watching the
 * session rather than for a log reader, because a truncated answer is the
 * first thing they notice.
 */
export function describeTermination(
  reason: TerminationReason,
  detail?: { maxSteps?: number },
): string | undefined {
  switch (reason) {
    case "no_tool_calls":
    case "user_abort":
    case "hook_stop":
    case "tool_stop":
      return undefined;
    case "max_steps":
      return `Stopped after reaching the step limit of ${detail?.maxSteps ?? "the configured maximum"}. The work may be incomplete.`;
    case "diminishing_returns":
      return "Stopped because recent steps stopped making progress. The work may be incomplete.";
    case "compaction_circuit_open":
      return "Stopped because automatic context compaction kept failing. The work may be incomplete.";
    case "stream_stall":
      return "Stopped because the model response kept ending before it finished. The work may be incomplete.";
    case "context_unrecoverable":
      return "Stopped because the conversation no longer fits the context window and compaction could not shrink it. The work may be incomplete.";
    case "loop_detected":
      return "Stopped because the output repeated itself without making progress. The work may be incomplete.";
    case "request_timeout":
      return "Stopped because the request reached its time limit. The work may be incomplete.";
  }
}
