import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { describe, expect, it, vi } from "vitest";

import {
  compactChatHistory,
  findCompactionIndex,
} from "../compaction/index.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";

import {
  calculateContextUsagePercentage,
  countChatHistoryTokens,
} from "./tokenizer.js";

vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(),
}));

const model = {
  name: "test-model",
  provider: "test",
  model: "test-model",
  defaultCompletionOptions: { contextLength: 128_000, maxTokens: 2048 },
} as ModelConfig;

function usagePercentage(history: ChatHistoryItem[]): number {
  return calculateContextUsagePercentage(
    countChatHistoryTokens(history, model),
    model,
  );
}

function buildLongHistory(): ChatHistoryItem[] {
  const rawMessages: any[] = [{ role: "system", content: "System prompt" }];
  for (let i = 0; i < 40; i++) {
    rawMessages.push({
      role: "user",
      content: `Question ${i} ` + "x".repeat(2000),
    });
    rawMessages.push({
      role: "assistant",
      content: `Answer ${i} ` + "y".repeat(2000),
    });
  }
  rawMessages.push({ role: "user", content: "Latest question" });
  return convertToUnifiedHistory(rawMessages);
}

describe("context percentage after compaction", () => {
  it("drops the usage percentage and leaves an observable boundary", async () => {
    vi.mocked(streamChatResponse).mockImplementation(async () => "short recap");

    const history = buildLongHistory();
    const before = usagePercentage(history);

    const result = await compactChatHistory(history, model, {} as BaseLlmApi);

    const after = usagePercentage(result.compactedHistory);

    expect(after).toBeLessThan(before);
    expect(findCompactionIndex(result.compactedHistory)).not.toBeNull();

    const checkpoint = result.compactedHistory.find(
      (item) => item.compactionCheckpoint?.kind === "compact-checkpoint",
    );
    expect(checkpoint?.conversationSummary).toContain("short recap");
  });
});
