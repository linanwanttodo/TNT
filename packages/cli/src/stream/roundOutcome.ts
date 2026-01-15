import type { LoopDetection } from "../loop/loopDetector.js";
import type { TerminalStopKind } from "../loop/terminalStop.js";
import {
  REQUEST_TIMEOUT_ABORT,
  type TerminationReason,
} from "../loop/termination.js";

/**
 * What one round's stream outcome means for the turn.
 *
 * The order is the policy: an interrupted stream is reported as an interrupt
 * before any fault it happened to produce, a length refusal is recoverable only
 * while attempts remain, an early end with retry budget is retried, and output
 * repetition is the last interpretation because a stall can look repetitive.
 */
export type RoundOutcome =
  | { kind: "abort"; reason: TerminationReason }
  | { kind: "overflow"; exhausted: boolean }
  | { kind: "terminal"; stop: TerminalStopKind }
  | { kind: "loop"; detection: LoopDetection }
  | { kind: "continue" };

export interface RoundOutcomeInput {
  aborted: boolean;
  abortReason?: unknown;
  terminalStop?: TerminalStopKind;
  loopDetection?: LoopDetection;
  overflowRecoveries: number;
  maxOverflowRecoveries: number;
}

export function classifyRoundOutcome(input: RoundOutcomeInput): RoundOutcome {
  if (input.aborted) {
    return {
      kind: "abort",
      reason:
        input.abortReason === REQUEST_TIMEOUT_ABORT
          ? "request_timeout"
          : "user_abort",
    };
  }

  if (input.terminalStop === "context_overflow") {
    return {
      kind: "overflow",
      exhausted: input.overflowRecoveries >= input.maxOverflowRecoveries,
    };
  }

  if (input.terminalStop) {
    return { kind: "terminal", stop: input.terminalStop };
  }

  // Repetition is checked after the abort test so an interrupted stream is
  // never reported as a model loop.
  if (input.loopDetection) {
    return { kind: "loop", detection: input.loopDetection };
  }

  return { kind: "continue" };
}
