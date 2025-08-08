import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { describe, expect, it, vi } from "vitest";

import { compactChatHistory } from "./index.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";

// Mock the dependencies
vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(),
}));

vi.mock("../utils/tokenizer.js", () => ({
  countChatHistoryTokens: vi.fn(),
  getModelContextLimit: vi.fn(),
  getModelMaxTokens: vi.fn(),
}));

describe("compaction infinite loop prevention", () => {
  const mockModel: ModelConfig = {
    name: "test-model",
    provider: "test",
    model: "test-model",
    defaultCompletionOptions: {
      maxTokens: 1000,
      contextLength: 4000,
    },
  } as ModelConfig;

  const mockLlmApi = {} as BaseLlmApi;

  it("should not loop infinitely when pruning doesn't reduce history size", async () => {
    const { countChatHistoryTokens, getModelContextLimit, getModelMaxTokens } =
      await import("../utils/tokenizer.js");
    const mockStreamResponse = vi.mocked(streamChatResponse);
    const mockCountTokens = vi.mocked(countChatHistoryTokens);
    const mockGetContextLimit = vi.mocked(getModelContextLimit);

    // Setup mocks
    mockGetContextLimit.mockReturnValue(4000);
    vi.mocked(getModelMaxTokens).mockReturnValue(1000);
    mockCountTokens.mockReturnValue(5000); // Always too big
    mockStreamResponse.mockImplementation(
      async (history, model, api, controller, callbacks) => {
        callbacks?.onContent?.("Summary");
        callbacks?.onContentComplete?.("Summary");
        return "Summary";
      },
    );

    // History that can't be pruned further (only system message)
    const history = convertToUnifiedHistory([
      { role: "system", content: "System message" },
    ]);

    // This should not hang - it should break out of the loop
    await expect(
      compactChatHistory(history, mockModel, mockLlmApi),
    ).rejects.toThrow(
      "Compaction request exceeds the available context budget",
    );
    expect(mockStreamResponse).not.toHaveBeenCalled();
    expect(mockCountTokens).toHaveBeenCalled();
  });

  it("should not loop infinitely with history ending in assistant message", async () => {
    const { countChatHistoryTokens, getModelContextLimit, getModelMaxTokens } =
      await import("../utils/tokenizer.js");
    const mockStreamResponse = vi.mocked(streamChatResponse);
    const mockCountTokens = vi.mocked(countChatHistoryTokens);
    const mockGetContextLimit = vi.mocked(getModelContextLimit);

    // Setup mocks
    mockGetContextLimit.mockReturnValue(4000);
    vi.mocked(getModelMaxTokens).mockReturnValue(1000);
    mockCountTokens.mockReturnValue(5000); // Always too big
    mockStreamResponse.mockImplementation(
      async (history, model, api, controller, callbacks) => {
        callbacks?.onContent?.("Summary");
        callbacks?.onContentComplete?.("Summary");
        return "Summary";
      },
    );

    // History that ends with assistant - pruning won't change it
    const history = convertToUnifiedHistory([
      { role: "system", content: "System message" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);

    // This should not hang
    await expect(
      compactChatHistory(history, mockModel, mockLlmApi),
    ).rejects.toThrow(
      "Compaction request exceeds the available context budget",
    );
    expect(mockStreamResponse).not.toHaveBeenCalled();
  });

  it("should successfully prune when pruning actually reduces size", async () => {
    const { countChatHistoryTokens, getModelContextLimit, getModelMaxTokens } =
      await import("../utils/tokenizer.js");
    const mockStreamResponse = vi.mocked(streamChatResponse);
    const mockCountTokens = vi.mocked(countChatHistoryTokens);
    const mockGetContextLimit = vi.mocked(getModelContextLimit);

    // Setup mocks
    mockGetContextLimit.mockReturnValue(4000);
    vi.mocked(getModelMaxTokens).mockReturnValue(1000);

    mockCountTokens.mockImplementation((history) => {
      const isSummaryRequest = history.some((item) =>
        String(item.message.content).includes(
          "Please provide a concise summary",
        ),
      );
      if (isSummaryRequest) {
        return history.length > 3 ? 5000 : 2000;
      }
      return history.length * 100;
    });

    mockStreamResponse.mockImplementation(
      async (history, model, api, controller, callbacks) => {
        callbacks?.onContent?.("Summary");
        callbacks?.onContentComplete?.("Summary");
        return "Summary";
      },
    );

    // History that can be successfully pruned
    const history = convertToUnifiedHistory([
      { role: "system", content: "System message" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Another question" },
    ]);

    const result = await compactChatHistory(history, mockModel, mockLlmApi);

    expect(result.compactedHistory).toBeDefined();
    // The function will call countTokens multiple times during the process
    expect(mockCountTokens).toHaveBeenCalled();
  });
});
