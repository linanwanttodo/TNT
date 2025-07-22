import type { SessionUsage } from "core/index.js";
import { describe, expect, it } from "vitest";

import { getCacheHitRatio } from "./cacheRatio.js";

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    totalCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    promptTokensDetails: { cachedTokens: 0, cacheWriteTokens: 0 },
    ...overrides,
  };
}

describe("getCacheHitRatio", () => {
  it("returns undefined without usage", () => {
    expect(getCacheHitRatio(undefined)).toBeUndefined();
    expect(getCacheHitRatio(null)).toBeUndefined();
  });

  it("returns undefined when no cache tokens were reported", () => {
    expect(getCacheHitRatio(usage({ promptTokens: 1000 }))).toBeUndefined();
    expect(
      getCacheHitRatio(
        usage({
          promptTokensDetails: { cachedTokens: 0, cacheWriteTokens: 0 },
        }),
      ),
    ).toBeUndefined();
  });

  it("uses promptTokens as the denominator when it covers the cached slice", () => {
    expect(
      getCacheHitRatio(
        usage({
          promptTokens: 1000,
          promptTokensDetails: { cachedTokens: 750, cacheWriteTokens: 0 },
        }),
      ),
    ).toBe(75);
  });

  it("falls back to cache totals when the prompt total excludes them", () => {
    expect(
      getCacheHitRatio(
        usage({
          promptTokens: 100,
          promptTokensDetails: { cachedTokens: 900, cacheWriteTokens: 100 },
        }),
      ),
    ).toBe(82);
  });

  it("never exceeds 100 percent", () => {
    expect(
      getCacheHitRatio(
        usage({
          promptTokens: 2000,
          promptTokensDetails: { cachedTokens: 1500, cacheWriteTokens: 1000 },
        }),
      ),
    ).toBe(33);
  });
});
