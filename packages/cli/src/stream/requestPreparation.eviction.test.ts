import type { ChatHistoryItem } from "core/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// End-to-end check of the request-preparation wiring: the eviction must run
// inside the real prepareRoundRequest path, not only in its module's own
// tests. Heavy collaborators are stubbed to pass the history through, so what
// this file asserts is exactly the wiring — including the warm-cache gate,
// whose temperature comes from microCompact's request clock.
vi.mock("../cache/prefixState.js", () => ({
  recallCachePrefix: vi.fn(() => undefined),
  rememberCachePrefix: vi.fn(),
  classifyCachePrefix: vi.fn(() => undefined),
  cachePrefixKeys: vi.fn(() => ({})),
}));
vi.mock("../compaction/measuredContext.js", () => ({
  measuredRequestFor: vi.fn(() => undefined),
}));
vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePreApiCompaction: vi.fn(async (history: ChatHistoryItem[]) => ({
    chatHistory: history,
    wasCompacted: false,
  })),
}));
vi.mock("../utils/tokenizer.js", () => ({
  getModelContextLimit: vi.fn(() => 1_000_000),
  getModelMaxTokens: vi.fn(() => 64_000),
  countToolDefinitionTokens: vi.fn(() => 0),
  countChatHistoryItemTokens: vi.fn(() => 0),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  forgetLastRequest,
  noteRequestSent,
} from "../compaction/microCompact.js";

import { prepareRoundRequest } from "./requestPreparation.js";
import { EVICTION_PLACEHOLDER } from "./toolOutputEviction.js";

const model = {
  provider: "anthropic",
  model: "deepseek-flash",
} as any;

const previousGap = process.env.TNT_CACHE_GAP_MS;

afterEach(() => {
  forgetLastRequest();
  if (previousGap === undefined) {
    delete process.env.TNT_CACHE_GAP_MS;
  } else {
    process.env.TNT_CACHE_GAP_MS = previousGap;
  }
});

function toolHeavyHistory(): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = [
    { message: { role: "user", content: "start" }, contextItems: [] },
  ];
  for (let i = 0; i < 8; i += 1) {
    items.push({
      message: { role: "assistant", content: `call ${i}` },
      contextItems: [],
    });
    items.push({
      message: {
        role: "tool",
        toolCallId: `call-${i}`,
        content: "x".repeat(60_000),
      },
      contextItems: [],
    });
  }
  return items;
}

function options(history: ChatHistoryItem[], cacheKey = "test-cache-key") {
  return {
    chatHistory: history,
    requestHeader: { model: "deepseek-flash", systemMessage: "", tools: [] },
    promptCacheKey: cacheKey,
    isCompacting: false,
    coldTurn: false,
    historyRewritten: false,
    forceCompaction: false,
    compaction: {
      model,
      llmApi: {} as any,
      isHeadless: true,
      callbacks: undefined,
      systemMessage: "",
      tools: [],
    },
  } as any;
}

describe("prepareRoundRequest eviction wiring", () => {
  // The 8 x 60k-char results ≈ 120k tokens cross the 100k gate on a 1M
  // window, so the three oldest results are the eviction candidates and the
  // newest five keep their bytes.
  it("evicts old tool results when the cache is cold", async () => {
    process.env.TNT_CACHE_GAP_MS = "1000";
    noteRequestSent(Date.now() - 60 * 60_000);
    const history = toolHeavyHistory();
    const prepared = await prepareRoundRequest(options(history));

    const tools = prepared.chatHistory.filter(
      (item) => item.message.role === "tool",
    );
    // A cold window re-pays nothing for the rewrite, so the three oldest
    // results come back as placeholders and the newest five keep their bytes.
    expect(
      tools
        .slice(0, 3)
        .every(
          (item) =>
            item.message.role === "tool" &&
            item.message.content === EVICTION_PLACEHOLDER,
        ),
    ).toBe(true);
    for (let i = 5; i < 8; i += 1) {
      const entry = tools[i];
      expect(entry.message.role === "tool" && entry.message.content).toBe(
        "x".repeat(60_000),
      );
    }
    // The first growth is folded into the verdict, so the cache-break report
    // names the eviction instead of an unexplained miss.
    expect(prepared.verdict).toMatchObject({
      state: "invalidated",
      reasons: ["tool_eviction"],
    });
  });

  it("defers growth on a warm cache when the tail re-pay dominates", async () => {
    process.env.TNT_CACHE_GAP_MS = "1000";
    noteRequestSent();
    const history = toolHeavyHistory();
    const prepared = await prepareRoundRequest(
      options(history, "warm-defer-scope"),
    );

    // deepseek-flash has no pricing row, so the conservative 0.1 discount
    // prices the ~45k-token saving far below re-paying the ~75k-token tail at
    // full price; growth waits for a cold window and the bytes go unchanged.
    expect(prepared.chatHistory).toBe(history);
    expect(prepared.verdict).toBeUndefined();
  });

  it("keeps an already-applied set stable on a warm cache", async () => {
    process.env.TNT_CACHE_GAP_MS = "1000";
    const history = toolHeavyHistory();

    noteRequestSent(Date.now() - 60 * 60_000);
    const cold = await prepareRoundRequest(options(history, "stable-scope"));
    noteRequestSent();
    // Same raw transcript again: the set must not shrink back (that would
    // move the prefix the other way), it holds at what the cache carries.
    const warm = await prepareRoundRequest(options(history, "stable-scope"));

    expect(warm.chatHistory).toEqual(cold.chatHistory);
  });

  it("sends small histories through untouched", async () => {
    const history: ChatHistoryItem[] = [
      { message: { role: "user", content: "hi" }, contextItems: [] },
      {
        message: { role: "tool", toolCallId: "t1", content: "small" },
        contextItems: [],
      },
    ];
    const prepared = await prepareRoundRequest(options(history));

    expect(prepared.chatHistory).toBe(history);
    expect(prepared.compacted).toBe(false);
  });
});
