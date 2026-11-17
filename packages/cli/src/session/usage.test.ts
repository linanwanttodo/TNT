import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("uuid", () => ({ v4: vi.fn(() => "cold-start-session") }));
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "../utils/logger.js";

import {
  clearSession,
  compactionReductionBucket,
  getSessionUsage,
  noteUnreportedRequest,
  trackCompactionReduction,
  trackSessionUsage,
} from "./index.js";

describe("session cold-start cache attribution", () => {
  beforeEach(() => {
    clearSession();
    vi.mocked(logger.info).mockClear();
  });

  const usage = (cached: number, cacheWrite: number) => ({
    promptTokens: 500,
    completionTokens: 100,
    promptTokensDetails: { cachedTokens: cached, cacheWriteTokens: cacheWrite },
  });

  it("records the first turn request separately", () => {
    trackSessionUsage(0.01, usage(0, 512), "turn");
    expect(getSessionUsage().coldStart).toEqual({
      inputTokens: 500,
      cachedTokens: 0,
      cacheWriteTokens: 512,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Session cache cold start",
      expect.objectContaining({ inputTokens: 500, cacheWriteTokens: 512 }),
    );
  });

  it("does not let later requests overwrite the cold start", () => {
    trackSessionUsage(0.01, usage(0, 512), "turn");
    trackSessionUsage(0.01, usage(480, 0), "turn");
    expect(getSessionUsage().coldStart).toEqual({
      inputTokens: 500,
      cachedTokens: 0,
      cacheWriteTokens: 512,
    });
  });

  it("still accumulates cold-start tokens into the session totals", () => {
    trackSessionUsage(0.01, usage(0, 512), "turn");
    trackSessionUsage(0.01, usage(480, 0), "turn");
    expect(getSessionUsage().promptTokensDetails?.cachedTokens).toBe(480);
    expect(getSessionUsage().promptTokensDetails?.cacheWriteTokens).toBe(512);
  });

  it("does not count a compaction request as the cold start", () => {
    trackSessionUsage(0.01, usage(0, 512), "compaction");
    expect(getSessionUsage().coldStart).toBeUndefined();

    trackSessionUsage(0.01, usage(0, 384), "turn");
    expect(getSessionUsage().coldStart).toEqual({
      inputTokens: 500,
      cachedTokens: 0,
      cacheWriteTokens: 384,
    });
  });

  it("records a cold start again after a new session begins", () => {
    trackSessionUsage(0.01, usage(0, 512), "turn");
    clearSession();
    trackSessionUsage(0.01, usage(0, 256), "turn");
    expect(getSessionUsage().coldStart).toEqual({
      inputTokens: 500,
      cachedTokens: 0,
      cacheWriteTokens: 256,
    });
  });
});

describe("compaction usage accounting", () => {
  beforeEach(() => {
    clearSession();
    vi.mocked(logger.info).mockClear();
  });

  const request = (
    promptTokens: number,
    completionTokens: number,
    cachedTokens: number,
    cacheWriteTokens: number,
  ) => ({
    promptTokens,
    completionTokens,
    promptTokensDetails: { cachedTokens, cacheWriteTokens },
  });

  it("counts a compaction request apart from the cold start", () => {
    trackSessionUsage(0.25, request(20000, 800, 12000, 0), "compaction");

    const session = getSessionUsage();
    expect(session.compaction).toEqual({
      requests: 1,
      inputTokens: 20000,
      outputTokens: 800,
      cachedTokens: 12000,
      cacheWriteTokens: 0,
      cost: 0.25,
    });
    expect(session.coldStart).toBeUndefined();
  });

  it("accumulates compaction requests and logs the cache read with the cost", () => {
    trackSessionUsage(0.25, request(20000, 800, 12000, 0), "compaction");
    trackSessionUsage(0.05, request(4000, 200, 0, 4000), "compaction");

    const compaction = getSessionUsage().compaction;
    expect(compaction?.requests).toBe(2);
    expect(compaction?.inputTokens).toBe(24000);
    expect(compaction?.outputTokens).toBe(1000);
    expect(compaction?.cachedTokens).toBe(12000);
    expect(compaction?.cacheWriteTokens).toBe(4000);
    expect(compaction?.cost).toBeCloseTo(0.3, 10);

    expect(logger.info).toHaveBeenLastCalledWith(
      "Compaction usage",
      expect.objectContaining({
        inputTokens: 4000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 4000,
        cost: 0.05,
        requests: 2,
        costSoFar: expect.closeTo(0.3, 10),
      }),
    );
  });

  it("reports the hit ratio of the compaction request itself", () => {
    trackSessionUsage(0.1, request(10000, 400, 7500, 0), "compaction");

    expect(logger.info).toHaveBeenCalledWith(
      "Compaction usage",
      expect.objectContaining({
        inputTokens: 10000,
        cacheReadTokens: 7500,
        cacheHitRatio: 0.75,
      }),
    );
  });

  it("clears the compaction bucket with the session", () => {
    trackSessionUsage(0.25, request(20000, 800, 12000, 0), "compaction");
    clearSession();

    expect(getSessionUsage().compaction).toBeUndefined();
  });

  it("does not count a turn as compaction", () => {
    trackSessionUsage(0.01, request(500, 100, 0, 512), "turn");

    expect(getSessionUsage().compaction).toBeUndefined();
  });
});

/**
 * A round that was cut off, or a provider that finishes without ever sending
 * its counts, is billed by the provider and invisible here: the session sums
 * and therefore the cache ratio are computed over fewer requests than the
 * session made. The counter is what makes that visible instead of leaving a
 * confident number beside a silent gap.
 */
describe("requests whose usage the provider never reported", () => {
  beforeEach(() => {
    clearSession();
  });

  const silent = { promptTokens: 0, completionTokens: 0 };
  const reported = { promptTokens: 1200, completionTokens: 80 };

  it("counts a completed round that carried no token counts", () => {
    trackSessionUsage(0, silent, "turn");

    expect(getSessionUsage().unreportedUsageRequests).toBe(1);
  });

  it("counts a round that ended before any usage arrived", () => {
    noteUnreportedRequest();

    expect(getSessionUsage().unreportedUsageRequests).toBe(1);
  });

  it("does not count a round the provider reported", () => {
    trackSessionUsage(0.01, reported, "turn");

    expect(getSessionUsage().unreportedUsageRequests ?? 0).toBe(0);
  });

  it("keeps both sides so the ratio can say what it covers", () => {
    trackSessionUsage(0.01, reported, "turn");
    trackSessionUsage(
      0.02,
      { promptTokens: 2_000, completionTokens: 90 },
      "turn",
    );
    noteUnreportedRequest();

    const usageTotals = getSessionUsage();
    expect(usageTotals.reportedUsageRequests).toBe(2);
    expect(usageTotals.unreportedUsageRequests).toBe(1);
  });

  it("clears with the session", () => {
    noteUnreportedRequest();
    noteUnreportedRequest();
    clearSession();

    expect(getSessionUsage().unreportedUsageRequests ?? 0).toBe(0);
  });
});

describe("compaction reduction buckets", () => {
  beforeEach(() => {
    clearSession();
  });

  it("sorts ratios into the threshold floor below the worthwhile minimum", () => {
    expect(compactionReductionBucket(0.005)).toBe("threshold_floor");
  });

  it("sorts ratios into the four size buckets", () => {
    expect(compactionReductionBucket(0.2)).toBe("lt_50");
    expect(compactionReductionBucket(0.5)).toBe("50_79");
    expect(compactionReductionBucket(0.79)).toBe("50_79");
    expect(compactionReductionBucket(0.8)).toBe("80_99");
    expect(compactionReductionBucket(0.99)).toBe("80_99");
    expect(compactionReductionBucket(1)).toBe("gte_100");
  });

  it("counts each compaction into its bucket", () => {
    trackCompactionReduction(0.6);
    trackCompactionReduction(0.95);
    trackCompactionReduction(0.003);

    expect(getSessionUsage().compaction?.reductionBuckets).toEqual({
      "50_79": 1,
      "80_99": 1,
      threshold_floor: 1,
    });
  });

  it("keeps the bucket tallies beside the compaction totals", () => {
    trackSessionUsage(
      0.25,
      {
        promptTokens: 20000,
        completionTokens: 800,
        promptTokensDetails: { cachedTokens: 0, cacheWriteTokens: 0 },
      },
      "compaction",
    );
    trackCompactionReduction(0.7);

    const compaction = getSessionUsage().compaction;
    expect(compaction?.requests).toBe(1);
    expect(compaction?.inputTokens).toBe(20000);
    expect(compaction?.reductionBuckets).toEqual({ "50_79": 1 });
  });
});

describe("per-agent usage rows", () => {
  beforeEach(() => {
    clearSession();
  });

  const usage = (promptTokens: number, completionTokens: number) => ({
    promptTokens,
    completionTokens,
  });

  it("keeps two parallel agents' usage in separate rows", () => {
    trackSessionUsage(0.1, usage(1000, 100), "turn", false, {
      agentType: "explorer",
      sessionId: "child-1",
    });
    trackSessionUsage(0.2, usage(2000, 200), "turn", false, {
      agentType: "explorer",
      sessionId: "child-2",
    });

    const rows = getSessionUsage().agentRows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      agentType: "explorer",
      sessionId: "child-1",
      cost: 0.1,
      promptTokens: 1000,
      completionTokens: 100,
      rounds: 1,
    });
    expect(rows[1]).toMatchObject({
      agentType: "explorer",
      sessionId: "child-2",
      rounds: 1,
    });
  });

  it("merges later rounds of the same agent into its row", () => {
    trackSessionUsage(0.1, usage(1000, 100), "turn", false, {
      agentType: "explorer",
      sessionId: "child-1",
    });
    trackSessionUsage(0.05, usage(500, 50), "turn", false, {
      agentType: "explorer",
      sessionId: "child-1",
    });

    const rows = getSessionUsage().agentRows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      promptTokens: 1500,
      completionTokens: 150,
      rounds: 2,
    });
    expect(rows[0].cost).toBeCloseTo(0.15, 10);
  });

  it("leaves the process-wide totals untouched", () => {
    trackSessionUsage(0.1, usage(1000, 100), "turn", false, {
      agentType: "explorer",
      sessionId: "child-1",
    });
    trackSessionUsage(0.3, usage(3000, 300), "turn");

    const session = getSessionUsage();
    expect(session.totalCost).toBeCloseTo(0.4, 10);
    expect(session.promptTokens).toBe(4000);
    expect(session.completionTokens).toBe(400);
  });

  it("clears the agent rows with the session", () => {
    trackSessionUsage(0.1, usage(1000, 100), "turn", false, {
      agentType: "explorer",
      sessionId: "child-1",
    });
    clearSession();

    expect(getSessionUsage().agentRows).toBeUndefined();
  });
});

describe("system prompt rewrite audit", () => {
  beforeEach(() => {
    clearSession();
  });

  const usage = { promptTokens: 1000, completionTokens: 100 };

  it("counts the rounds that rewrote the system prompt", () => {
    trackSessionUsage(0.01, usage, "turn", false, {
      systemPromptRewritten: true,
    });
    trackSessionUsage(0.01, usage, "turn");
    trackSessionUsage(0.01, usage, "turn", false, {
      systemPromptRewritten: true,
    });

    expect(getSessionUsage().systemPromptRewrites).toBe(2);
  });

  it("stays undefined while no round rewrote", () => {
    trackSessionUsage(0.01, usage, "turn");

    expect(getSessionUsage().systemPromptRewrites).toBeUndefined();
  });
});
