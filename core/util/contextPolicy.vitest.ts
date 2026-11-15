import { describe, expect, it } from "vitest";

import {
  calculateContextBudget,
  calculateMaxOutputTokens,
} from "./contextPolicy.js";

describe("calculateContextBudget", () => {
  it("uses the lower of the proportional and output-reserved thresholds", () => {
    // 0.8 × 128k is 102.4k, but the absolute ceiling is 100k, so the ceiling
    // wins: the working set stays at the same budget whatever the window is.
    expect(calculateContextBudget(128_000, 8_000)).toEqual({
      compactAtTokens: 100_000,
      retainTokens: 19_200,
    });

    expect(calculateContextBudget(128_000, 80_000)).toEqual({
      compactAtTokens: 47_936,
      retainTokens: 7_680,
    });
  });

  it("caps compaction and retention absolutely for very large windows", () => {
    // A 1M window must not turn 0.8× into an 800k compaction threshold, nor
    // keep a 150k tail after summarizing: both are absolute caps. The 100k
    // ceiling is what keeps a request's input tokens near a fixed budget
    // instead of drifting to the window size.
    expect(calculateContextBudget(1_000_000, 64_000)).toEqual({
      compactAtTokens: 100_000,
      retainTokens: 32_000,
    });
  });

  it("rejects budgets with no safe input space", () => {
    expect(() => calculateContextBudget(64, 0)).toThrow(
      "Context window has no safe input space",
    );
  });
});

describe("calculateMaxOutputTokens", () => {
  it("shrinks output tokens to the remaining context budget", () => {
    expect(calculateMaxOutputTokens(16_000, 15_000, 4_000)).toBe(936);
  });

  it("does not increase the configured output limit", () => {
    expect(calculateMaxOutputTokens(16_000, 1_000, 4_000)).toBe(4_000);
  });

  it("returns zero when the input has exhausted the safe output space", () => {
    expect(calculateMaxOutputTokens(16_000, 16_000, 4_000)).toBe(0);
  });
});
