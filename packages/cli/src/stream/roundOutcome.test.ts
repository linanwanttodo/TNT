import { describe, expect, it } from "vitest";

import type { LoopDetection } from "../loop/loopDetector.js";
import { REQUEST_TIMEOUT_ABORT } from "../loop/termination.js";

import { classifyRoundOutcome } from "./roundOutcome.js";

const LOOP: LoopDetection = {
  kind: "single_message_single_line",
  pattern: "same line",
  repetitions: 6,
  fingerprint: "fingerprint",
};

function classify(
  overrides: Partial<Parameters<typeof classifyRoundOutcome>[0]>,
) {
  return classifyRoundOutcome({
    aborted: false,
    overflowRecoveries: 0,
    maxOverflowRecoveries: 3,
    ...overrides,
  });
}

describe("what one round's stream outcome means", () => {
  it("reports an interrupt before any fault the interrupt produced", () => {
    expect(
      classify({
        aborted: true,
        abortReason: REQUEST_TIMEOUT_ABORT,
        terminalStop: "context_overflow",
        loopDetection: LOOP,
      }),
    ).toEqual({ kind: "abort", reason: "request_timeout" });

    expect(
      classify({ aborted: true, terminalStop: "context_overflow" }),
    ).toEqual({ kind: "abort", reason: "user_abort" });
  });

  it("recovers a length refusal while attempts remain", () => {
    expect(classify({ terminalStop: "context_overflow" })).toEqual({
      kind: "overflow",
      exhausted: false,
    });
  });

  it("gives up on a length refusal once the attempts are spent", () => {
    expect(
      classify({ terminalStop: "context_overflow", overflowRecoveries: 3 }),
    ).toEqual({ kind: "overflow", exhausted: true });
  });

  it("treats any other early end as a retryable stop", () => {
    expect(classify({ terminalStop: "stream_stall" })).toEqual({
      kind: "terminal",
      stop: "stream_stall",
    });
  });

  it("checks repetition only after abort and terminal stop", () => {
    expect(classify({ loopDetection: LOOP })).toEqual({
      kind: "loop",
      detection: LOOP,
    });
    expect(
      classify({ terminalStop: "stream_stall", loopDetection: LOOP }),
    ).toEqual({ kind: "terminal", stop: "stream_stall" });
  });

  it("continues when the round produced neither fault", () => {
    expect(classify({})).toEqual({ kind: "continue" });
  });
});
