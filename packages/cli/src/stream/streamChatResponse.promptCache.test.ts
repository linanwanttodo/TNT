import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processStreamingResponse } from "./streamChatResponse.js";

vi.mock("../session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session.js")>();
  return {
    ...actual,
    getCurrentSession: vi.fn(() => ({ sessionId: "session-a" })),
  };
});

vi.mock("../services/index.js", () => ({
  services: {
    hooks: { isReady: () => false },
    toolPermissions: { getState: () => ({ currentMode: "agent" }) },
  },
}));

describe("processStreamingResponse prompt cache key", () => {
  let chatCompletionStream: ReturnType<typeof vi.fn>;

  const model = {
    name: "test-model",
    provider: "test-provider",
    model: "test-model",
  } as unknown as ModelConfig;

  const chatHistory: ChatHistoryItem[] = [
    { message: { role: "user", content: "Test prompt" }, contextItems: [] },
  ];

  const requestBody = () =>
    chatCompletionStream.mock.calls[0][0] as Record<string, unknown>;

  beforeEach(() => {
    chatCompletionStream = vi.fn().mockImplementation(async function* () {
      yield {
        id: "test",
        object: "chat.completion.chunk",
        created: Date.now(),
        model: "test-model",
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
      };
    });
  });

  async function run() {
    await processStreamingResponse({
      chatHistory,
      model,
      llmApi: { chatCompletionStream } as unknown as BaseLlmApi,
      abortController: { signal: { aborted: false } } as AbortController,
      systemMessage: "",
    });
  }

  it("sends a key that follows the conversation", async () => {
    await run();

    expect(requestBody().prompt_cache_key).toBe("tnt-session-a");
  });

  it("reuses the parent key for a delegated run", async () => {
    const { getCurrentSession } = await import("../session.js");
    vi.mocked(getCurrentSession).mockReturnValue({
      sessionId: "session-a:1",
      parentSessionId: "session-a",
    } as any);

    await run();

    expect(requestBody().prompt_cache_key).toBe("tnt-session-a");
  });
});
