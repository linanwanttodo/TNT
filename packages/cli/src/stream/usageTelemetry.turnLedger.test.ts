import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../session/index.js", () => ({
  trackSessionUsage: vi.fn(),
}));

vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    recordTokenUsage: vi.fn(),
    recordCost: vi.fn(),
    recordResponseTime: vi.fn(),
    logApiRequest: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const cacheBreakReport = vi.hoisted(() => ({
  writeCacheBreakReport: vi.fn(() => "/tmp/cache-break.json"),
}));

vi.mock("../cache/cacheBreakReport.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../cache/cacheBreakReport.js")>();
  return {
    ...actual,
    writeCacheBreakReport: cacheBreakReport.writeCacheBreakReport,
  };
});

import {
  forgetCacheRounds,
  recordCacheRound,
  SYSTEM_PROMPT_REWRITE_REASON,
} from "../cache/cacheBreakReport.js";
import type { RequestHeader } from "../cache/requestHeader.js";

import {
  beginTurnUsage,
  endTurnUsage,
  peekTurnUsage,
  peekTurnUsageRows,
  recordRoundAccounting,
} from "./usageTelemetry.js";

const fullUsage = {
  prompt_tokens: 4_000,
  completion_tokens: 5,
  prompt_tokens_details: { cached_tokens: 3_900 },
};

function recordRound(
  options: {
    agentType?: string;
    sessionId?: string;
    systemPromptRewritten?: boolean;
    promptCacheKey?: string;
    cacheBreak?: boolean;
  } = {},
) {
  const cachePrefixComparison = options.cacheBreak
    ? {
        previous: { model: "m" } as RequestHeader,
        current: { model: "m" } as RequestHeader,
      }
    : undefined;
  return recordRoundAccounting({
    requestStartTime: Date.now(),
    responseEndTime: Date.now(),
    inputTokens: 4_000,
    outputTokens: 5,
    model: { model: "test-model" } as never,
    fullUsage,
    promptCacheKey: options.promptCacheKey,
    cachePrefixComparison,
    agentType: options.agentType,
    sessionId: options.sessionId,
    systemPromptRewritten: options.systemPromptRewritten,
  });
}

describe("the turn usage ledger's per-agent rows", () => {
  beforeEach(() => {
    beginTurnUsage();
  });

  it("keeps two parallel agents' rounds in their own rows", () => {
    recordRound({ agentType: "explorer", sessionId: "child-1" });
    recordRound({ agentType: "explorer", sessionId: "child-2" });

    const rows = peekTurnUsageRows();
    // The main surface sent nothing, so the two dispatches are the whole
    // ledger: each with its own dimensions and its own counts.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      agentType: "explorer",
      sessionId: "child-1",
      rounds: 1,
      inputTokens: 4_000,
    });
    expect(rows[1]).toMatchObject({
      agentType: "explorer",
      sessionId: "child-2",
      rounds: 1,
    });
  });

  it("merges interleaved rounds of the same agent into its row", () => {
    recordRound({ agentType: "explorer", sessionId: "child-1" });
    recordRound({ agentType: "planner", sessionId: "child-2" });
    recordRound({ agentType: "explorer", sessionId: "child-1" });

    const rows = peekTurnUsageRows();
    expect(rows).toHaveLength(2);
    const explorer = rows.find((row) => row.sessionId === "child-1");
    expect(explorer?.rounds).toBe(2);
    expect(explorer?.inputTokens).toBe(8_000);
    const planner = rows.find((row) => row.sessionId === "child-2");
    expect(planner?.rounds).toBe(1);
  });

  it("keeps the main surface's row apart from the agents' rows", () => {
    beginTurnUsage();
    recordRound({ agentType: "explorer", sessionId: "child-1" });
    recordRound();

    expect(peekTurnUsage()).toMatchObject({ rounds: 1, inputTokens: 4_000 });
    const rows = peekTurnUsageRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].agentType).toBeUndefined();
    expect(rows[1]).toMatchObject({ agentType: "explorer" });
    expect(endTurnUsage()).toMatchObject({ rounds: 1 });
  });

  it("restarts every row when a new turn begins", () => {
    recordRound({ agentType: "explorer", sessionId: "child-1" });
    beginTurnUsage();

    expect(peekTurnUsageRows()).toHaveLength(0);
  });
});

describe("the system prompt rewrite marker on a ledger row", () => {
  beforeEach(() => {
    beginTurnUsage();
  });

  it("marks the row whose round rewrote the prompt", () => {
    recordRound({ systemPromptRewritten: true });
    recordRound();

    expect(peekTurnUsage()).toMatchObject({
      rounds: 2,
      systemPromptRewritten: true,
    });
  });

  it("marks only the agent row that rewrote", () => {
    recordRound({ agentType: "explorer", sessionId: "child-1" });
    recordRound({
      agentType: "planner",
      sessionId: "child-2",
      systemPromptRewritten: true,
    });

    const rows = peekTurnUsageRows();
    expect(rows[0].systemPromptRewritten).toBeUndefined();
    expect(rows[1].systemPromptRewritten).toBe(true);
  });

  it("names the rewrite as a cause when the round also breaks the cache", () => {
    const key = "rewrite-round";
    forgetCacheRounds();
    recordCacheRound(key, { inputTokens: 10_000, cacheReadTokens: 9_000 });

    // The rewrite round re-billed nearly the whole prompt, so the break
    // detector fires; the report has to say the rewrite was part of it.
    recordRoundAccounting({
      requestStartTime: Date.now(),
      responseEndTime: Date.now(),
      inputTokens: 10_000,
      outputTokens: 5,
      model: { model: "test-model" } as never,
      fullUsage: {
        prompt_tokens: 10_000,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 2_000 },
      },
      promptCacheKey: key,
      cachePrefixComparison: {
        previous: { model: "m" } as RequestHeader,
        current: { model: "m" } as RequestHeader,
      },
      systemPromptRewritten: true,
    });

    expect(cacheBreakReport.writeCacheBreakReport).toHaveBeenCalledWith(
      expect.objectContaining({
        extraReasons: [SYSTEM_PROMPT_REWRITE_REASON],
      }),
    );
  });

  it("keeps the report without a rewrite cause on a plain break", () => {
    cacheBreakReport.writeCacheBreakReport.mockClear();
    const key = "plain-break";
    forgetCacheRounds();
    recordCacheRound(key, { inputTokens: 10_000, cacheReadTokens: 9_000 });

    recordRoundAccounting({
      requestStartTime: Date.now(),
      responseEndTime: Date.now(),
      inputTokens: 10_000,
      outputTokens: 5,
      model: { model: "test-model" } as never,
      fullUsage: {
        prompt_tokens: 10_000,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 2_000 },
      },
      promptCacheKey: key,
      cachePrefixComparison: {
        previous: { model: "m" } as RequestHeader,
        current: { model: "m" } as RequestHeader,
      },
    });

    expect(cacheBreakReport.writeCacheBreakReport).toHaveBeenCalledWith(
      expect.not.objectContaining({ extraReasons: expect.anything() }),
    );
  });
});
