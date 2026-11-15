import { beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCacheRounds } from "../cache/cacheBreakReport.js";
import { CACHE_HIT_TAIL_ROUNDS } from "../cache/cacheHitGuard.js";
import { logger } from "../utils/logger.js";

import { recordRoundAccounting } from "./usageTelemetry.js";

/**
 * The floor is a warning about the tail of a conversation, so these use a key
 * per case: the ring lives beside the module, and a shared key would let one
 * test's rounds count towards another's.
 */
function record(options: {
  key: string;
  cachedTokens?: number;
  promptTokens?: number;
}) {
  const promptTokens = options.promptTokens ?? 4_000;
  return recordRoundAccounting({
    requestStartTime: Date.now(),
    responseEndTime: Date.now(),
    inputTokens: promptTokens,
    outputTokens: 5,
    model: { model: "test-model" } as never,
    fullUsage: {
      prompt_tokens: promptTokens,
      completion_tokens: 5,
      total_tokens: promptTokens + 5,
      ...(options.cachedTokens === undefined
        ? {}
        : { prompt_tokens_details: { cached_tokens: options.cachedTokens } }),
    },
    promptCacheKey: options.key,
  });
}

function warnCallsFor(message: string) {
  return warn.mock.calls.filter(([line]) => line === message);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  forgetCacheRounds();
  warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
});

describe("the session cache hit floor", () => {
  it("warns once when the tail stops reading the cache", () => {
    const key = "floor-miss";
    // 100 of 4 000 cached is 2.5%: far under the 95% default.
    for (let round = 0; round < CACHE_HIT_TAIL_ROUNDS; round++) {
      record({ key, cachedTokens: 100 });
    }

    expect(warnCallsFor("Cache hit rate below floor")).toHaveLength(1);

    // A fourth bad round is the same conversation, still reported once.
    record({ key, cachedTokens: 100 });
    expect(warnCallsFor("Cache hit rate below floor")).toHaveLength(1);
  });

  it("stays quiet while the tail is reading the cache", () => {
    const key = "floor-hit";
    for (let round = 0; round < CACHE_HIT_TAIL_ROUNDS; round++) {
      record({ key, cachedTokens: 3_960 });
    }

    expect(warnCallsFor("Cache hit rate below floor")).toHaveLength(0);
  });

  it("judges on the tail, not the average of a cold start", () => {
    const key = "floor-warmup";
    // One cold round then a healthy tail: the average would still be low, the
    // tail is not.
    record({ key, cachedTokens: 0 });
    for (let round = 0; round < CACHE_HIT_TAIL_ROUNDS; round++) {
      record({ key, cachedTokens: 3_960 });
    }

    expect(warnCallsFor("Cache hit rate below floor")).toHaveLength(0);
  });

  it("does not judge a provider that reports no cache activity at all", () => {
    const key = "floor-silent-provider";
    for (let round = 0; round < CACHE_HIT_TAIL_ROUNDS; round++) {
      record({ key, cachedTokens: undefined });
    }

    expect(warnCallsFor("Cache hit rate below floor")).toHaveLength(0);
  });
});
