import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetCacheRounds,
  recallCacheRound,
} from "../cache/cacheBreakReport.js";

import { recordRoundAccounting } from "./usageTelemetry.js";

const CACHE_KEY = "session-key";

function record(options: { isCompacting?: boolean } = {}) {
  return recordRoundAccounting({
    requestStartTime: Date.now(),
    responseEndTime: Date.now(),
    inputTokens: 4_000,
    outputTokens: 5,
    model: { model: "test-model" } as never,
    fullUsage: {
      prompt_tokens: 4_000,
      completion_tokens: 5,
      total_tokens: 4_005,
      prompt_tokens_details: { cached_tokens: 3_900 },
    },
    isCompacting: options.isCompacting,
    promptCacheKey: CACHE_KEY,
  });
}

describe("recordRoundAccounting cache baseline", () => {
  beforeEach(() => {
    forgetCacheRounds();
  });

  it("records a turn round with its cache activity", () => {
    record();

    const round = recallCacheRound(CACHE_KEY);
    expect(round?.inputTokens).toBe(4_000);
    expect(round?.cacheReadTokens).toBe(3_900);
    expect(round?.cacheWriteTokens).toBe(0);
    expect(round?.reportedCache).toBe(true);
  });

  it("resets the baseline for a compaction round", () => {
    record();
    expect(recallCacheRound(CACHE_KEY)).toBeDefined();

    record({ isCompacting: true });

    // The summary request carries its own prefix; the next turn is new
    // content, not a re-billed conversation.
    expect(recallCacheRound(CACHE_KEY)).toBeUndefined();
  });
});
