import { describe, expect, it } from "vitest";

import {
  compactTokenCount,
  contextUsageLine,
  formatCostAmount,
} from "./contextUsageLine.js";

const TEST_LABELS = {
  ctx: "ctx",
  cache: "cache r/w",
  out: "out",
  cost: "cost",
} as const;

describe("the context-usage line", () => {
  it("is the owner's chosen format, character for character", () => {
    expect(
      contextUsageLine({
        usedTokens: 18200,
        limitTokens: 200000,
        cacheHitRatio: 92,
        outputTokens: 1400,
        cost: 0.31,
        labels: TEST_LABELS,
      }),
    ).toBe("ctx 18.2k/200k (9%) · cache r/w 92% · out 1.4k · cost $0.31");
  });

  it("compacts counts without inventing a digit", () => {
    expect(compactTokenCount(950)).toBe("950");
    expect(compactTokenCount(1400)).toBe("1.4k");
    expect(compactTokenCount(18200)).toBe("18.2k");
    expect(compactTokenCount(200000)).toBe("200k");
  });

  it("keeps a small cost from reading as free", () => {
    expect(formatCostAmount(0.31)).toBe("$0.31");
    expect(formatCostAmount(0.0042)).toBe("$0.0042");
    expect(formatCostAmount(0)).toBe("$0.0000");
  });

  it("falls back to the percentage when the denominator is unknown", () => {
    expect(
      contextUsageLine({ contextPercentage: 9, labels: TEST_LABELS }),
    ).toBe("ctx 9%");
  });

  it("caps a percentage that a provider reported over the window", () => {
    expect(
      contextUsageLine({ contextPercentage: 140, labels: TEST_LABELS }),
    ).toBe("ctx 100%");
  });

  it("drops a group with no number rather than showing zero", () => {
    expect(contextUsageLine({ cost: 0, labels: TEST_LABELS })).toBeUndefined();
    expect(
      contextUsageLine({ contextPercentage: 0, labels: TEST_LABELS }),
    ).toBe("ctx 0%");
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(contextUsageLine({ labels: TEST_LABELS })).toBeUndefined();
  });
});
