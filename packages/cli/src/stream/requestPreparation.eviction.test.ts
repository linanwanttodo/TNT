import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it, vi } from "vitest";

// End-to-end check of the request-preparation wiring: the eviction must run
// inside the real prepareRoundRequest path, not only in its module's own
// tests. Heavy collaborators are stubbed to pass the history through, so what
// this file asserts is exactly the wiring.
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

import { prepareRoundRequest } from "./requestPreparation.js";
import { EVICTION_PLACEHOLDER } from "./toolOutputEviction.js";

const model = {
  provider: "anthropic",
  model: "deepseek-flash",
} as any;

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

function options(history: ChatHistoryItem[]) {
  return {
    chatHistory: history,
    requestHeader: { model: "deepseek-flash", systemMessage: "", tools: [] },
    promptCacheKey: "test-cache-key",
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
  it("evicts old tool results from the history the round actually sends", async () => {
    const history = toolHeavyHistory();
    const prepared = await prepareRoundRequest(options(history));

    const tools = prepared.chatHistory.filter(
      (item) => item.message.role === "tool",
    );
    // The 8 x 60k-char results ≈ 120k tokens cross the 100k gate on a 1M
    // window, so the three oldest results come back as placeholders and the
    // newest five keep their bytes.
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
