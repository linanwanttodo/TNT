import { describe, expect, it } from "vitest";

import {
  calculateContextBudget,
  calculateMaxOutputTokens,
} from "./contextPolicy.js";

describe("calculateContextBudget", () => {
  it("uses the lower of the proportional and output-reserved thresholds", () => {
    expect(calculateContextBudget(128_000, 8_000)).toEqual({
      compactAtTokens: 102_400,
      retainTokens: 19_200,
    });

    expect(calculateContextBudget(128_000, 80_000)).toEqual({
      compactAtTokens: 47_936,
      retainTokens: 7_680,
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
