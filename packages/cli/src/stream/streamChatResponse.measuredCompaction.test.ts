import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import {
  clearMeasuredRequests,
  recordMeasuredRequest,
} from "../compaction/measuredContext.js";

import { handleAutoCompaction } from "./streamChatResponse.autoCompaction.js";

vi.mock("../cache/promptCacheKey.js", () => ({
  currentPromptCacheKey: vi.fn(() => "prefix-a"),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "s-1", history: [] })),
  getSessionHistoryGeneration: vi.fn(() => 0),
  replaceSessionHistoryIfGeneration: vi.fn(() => true),
}));

const decide = vi.hoisted(() => vi.fn(() => false));

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  findCompactionIndex: vi.fn(() => null),
  getAutoCompactMessage: vi.fn(() => "compacting"),
  shouldAutoCompact: decide,
}));

vi.mock("../hooks/fireHook.js", () => ({
  firePreCompact: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const model = {
  provider: "openai",
  model: "gpt-4",
  defaultCompletionOptions: { contextLength: 10_000, maxTokens: 1_000 },
} as never;

const chatHistory: ChatHistoryItem[] = [
  { message: { role: "user", content: "hello" }, contextItems: [] },
];

const measured = {
  promptTokens: 200,
  historyLength: 1,
  prefixKey: "prefix-a",
};

describe("the measurement handed to the compaction decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decide.mockReturnValue(false);
    clearMeasuredRequests();
    (currentPromptCacheKey as ReturnType<typeof vi.fn>).mockReturnValue(
      "prefix-a",
    );
  });

  it("carries the measurement taken under the prefix in use", async () => {
    recordMeasuredRequest("prefix-a", measured);

    await handleAutoCompaction(chatHistory, model, {} as never);

    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ measured }));
  });

  it("carries nothing once the prefix has moved", async () => {
    recordMeasuredRequest("prefix-a", measured);
    (currentPromptCacheKey as ReturnType<typeof vi.fn>).mockReturnValue(
      "prefix-b",
    );

    await handleAutoCompaction(chatHistory, model, {} as never);

    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        measured: undefined,
        prefixKey: "prefix-b",
      }),
    );
  });
});
