import { describe, expect, it } from "vitest";

import {
  contextUsage,
  formatContextUsage,
  formatTokens,
  formatTurnUsage,
} from "./contextReadout.js";

describe("provider-measured context readout", () => {
  it("formats context size using pi's token units", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });

  it("uses measured prompt tokens and the model window", () => {
    const usage = contextUsage(28_000, 262_000);
    expect(usage.percent).toBeCloseTo(10.687);
    expect(formatContextUsage(usage)).toBe("10.7%/262k");
  });

  it("does not invent a zero before a provider measurement exists", () => {
    expect(formatContextUsage(contextUsage(undefined, 200_000))).toBe("?/200k");
  });

  it("does not show a percentage when the model declares no window", () => {
    expect(formatContextUsage(contextUsage(100, 0))).toBe("?/0");
  });
});

describe("turn usage readout", () => {
  it("shows prompt, completion, cache hit and provider price separately", () => {
    expect(
      formatTurnUsage(
        {
          input: 12_660,
          output: 1_020,
          cacheRead: 6_885,
          cacheWrite: 100,
          cost: 0.0032,
        },
        12_760,
      ),
    ).toEqual(["↑13k", "↓1.0k", "R6.9k", "W100", "CH54.0%", "$0.003"]);
  });
});
