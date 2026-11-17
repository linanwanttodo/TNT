import { describe, expect, it } from "vitest";

import {
  calculateContextBudget,
  calculateMaxOutputTokens,
  CONTEXT_POLICY_REGISTRY,
} from "./contextPolicy.js";

describe("calculateContextBudget", () => {
  it("compacts at 90% of the window, the Cursor trigger", () => {
    // The 10% left over covers the reply and the tail the check cannot see
    // yet. No absolute cap sits underneath: the model's declared window is
    // the budget, so a 1M model is not compacted at a tenth of it.
    expect(calculateContextBudget(128_000, 8_000)).toEqual({
      compactAtTokens: 115_200,
      retainTokens: 19_200,
    });

    expect(calculateContextBudget(1_000_000, 64_000)).toEqual({
      compactAtTokens: 900_000,
      retainTokens: 32_000,
    });
  });

  it("never plans an input that leaves the reply no room", () => {
    // reservedOutput eats the window first: 0.9 × 128k would want 115.2k of
    // input, but only 48k of input capacity exists.
    expect(calculateContextBudget(128_000, 80_000)).toEqual({
      compactAtTokens: 47_936,
      retainTokens: 7_680,
    });
  });

  it("still honors an operator-imposed ceiling", () => {
    // A cost-sensitive deployment can restore an absolute cap; the default
    // policy ships without one.
    const policy = {
      ...CONTEXT_POLICY_REGISTRY.default,
      compactCeilingTokens: 60_000,
    };
    expect(calculateContextBudget(128_000, 8_000, policy)).toEqual({
      compactAtTokens: 60_000,
      retainTokens: 19_200,
    });
  });

  it("rejects budgets with no safe input space", () => {
    expect(() => calculateContextBudget(64, 0)).toThrow(
      "Context window has no safe input space",
    );
    expect(() =>
      calculateContextBudget(128_000, 8_000, {
        ...CONTEXT_POLICY_REGISTRY.default,
        compactCeilingTokens: 0,
      }),
    ).toThrow("Invalid context budget configuration");
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
