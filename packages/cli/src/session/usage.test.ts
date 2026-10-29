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
  getSessionUsage,
  noteUnreportedRequest,
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
