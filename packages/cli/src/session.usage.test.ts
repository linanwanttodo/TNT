import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("uuid", () => ({ v4: vi.fn(() => "cold-start-session") }));
vi.mock("./util/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { clearSession, getSessionUsage, trackSessionUsage } from "./session.js";
import { logger } from "./util/logger.js";

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
