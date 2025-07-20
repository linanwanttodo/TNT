import { describe, expect, it } from "vitest";

import {
  AUTO_COMPACTION_THRESHOLD,
  MAX_CONSECUTIVE_COMPACTION_FAILURES,
  createAutoCompactionState,
  isCompactionBreakerTripped,
  recordCompactionFailure,
  recordCompactionSuccess,
  shouldAutoCompact,
} from "./autoCompaction.js";

describe("shouldAutoCompact", () => {
  it("stays off below the threshold", () => {
    const state = createAutoCompactionState();
    expect(shouldAutoCompact(AUTO_COMPACTION_THRESHOLD - 0.01, state)).toBe(
      false,
    );
  });

  it("triggers at the threshold and above", () => {
    const state = createAutoCompactionState();
    expect(shouldAutoCompact(AUTO_COMPACTION_THRESHOLD, state)).toBe(true);
    expect(shouldAutoCompact(0.99, state)).toBe(true);
  });

  it("does nothing without a usable percentage", () => {
    const state = createAutoCompactionState();
    expect(shouldAutoCompact(undefined, state)).toBe(false);
    expect(shouldAutoCompact(Number.NaN, state)).toBe(false);
    expect(shouldAutoCompact(Number.POSITIVE_INFINITY, state)).toBe(false);
  });

  it("does not start a second compaction while one is running", () => {
    const state = { ...createAutoCompactionState(), inFlight: true };
    expect(shouldAutoCompact(0.95, state)).toBe(false);
  });

  it("stops attempting once the breaker trips", () => {
    let state = createAutoCompactionState();
    for (let i = 0; i < MAX_CONSECUTIVE_COMPACTION_FAILURES; i++) {
      state = recordCompactionFailure(state);
    }
    expect(isCompactionBreakerTripped(state)).toBe(true);
    expect(shouldAutoCompact(0.99, state)).toBe(false);
  });
});

describe("failure tracking", () => {
  it("counts consecutive failures", () => {
    let state = createAutoCompactionState();
    state = recordCompactionFailure(state);
    expect(state.consecutiveFailures).toBe(1);
    state = recordCompactionFailure(state);
    expect(state.consecutiveFailures).toBe(2);
  });

  it("resets the count on success", () => {
    let state = createAutoCompactionState();
    state = recordCompactionFailure(state);
    state = recordCompactionFailure(state);
    state = recordCompactionSuccess(state);

    expect(state.consecutiveFailures).toBe(0);
    expect(isCompactionBreakerTripped(state)).toBe(false);
  });

  it("clears the in-flight flag on both outcomes", () => {
    const inFlight = { ...createAutoCompactionState(), inFlight: true };
    expect(recordCompactionFailure(inFlight).inFlight).toBe(false);
    expect(recordCompactionSuccess(inFlight).inFlight).toBe(false);
  });
});
