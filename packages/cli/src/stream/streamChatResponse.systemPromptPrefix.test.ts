import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { streamChatResponse } from "./streamChatResponse.js";

vi.mock("../compaction.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history: ChatHistoryItem[]) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(() => "Auto-compacting..."),
}));

vi.mock("../session.js", () => ({
  updateSessionHistory: vi.fn(),
  trackSessionUsage: vi.fn(),
}));

vi.mock("../util/tokenizer.js", () => ({
  countChatHistoryItemTokens: vi.fn(() => 100),
  validateContextLength: vi.fn(() => ({ isValid: true })),
}));

vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    logApiRequest: vi.fn(),
    recordResponseTime: vi.fn(),
    recordTokenUsage: vi.fn(),
    recordCost: vi.fn(),
  },
}));

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: {
      getSystemMessage: vi.fn(),
    },
    toolPermissions: {
      getState: vi.fn(() => ({ currentMode: "enabled" })),
      isHeadless: vi.fn(() => false),
    },
    chatHistory: {
      isReady: vi.fn(() => false),
      getHistory: vi.fn(() => []),
      setHistory: vi.fn(),
      addUserMessage: vi.fn(),
    },
  },
}));

vi.mock("./handleToolCalls.js", () => ({
  handleToolCalls: vi.fn(() => Promise.resolve(false)),
  getRequestTools: vi.fn(() => Promise.resolve([])),
}));

vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePreApiCompaction: vi.fn((chatHistory: ChatHistoryItem[]) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handlePostToolValidation: vi.fn(
    (_toolCalls: unknown[], chatHistory: ChatHistoryItem[]) =>
      Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handleNormalAutoCompaction: vi.fn((chatHistory: ChatHistoryItem[]) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
}));

describe("streamChatResponse system prompt prefix", () => {
  const model = {
    provider: "openai",
    name: "test-model",
    model: "test-model",
    defaultCompletionOptions: {
      contextLength: 8192,
      maxTokens: 2048,
    },
    chatOptions: {
      supportsInHistorySystemUpdates: true,
    },
  } as ModelConfig;

  let chatHistory: ChatHistoryItem[];
  let llmApi: BaseLlmApi;
  let requests: any[];

  function contentChunk(content: string): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    } as ChatCompletionChunk;
  }

  function toolCallChunk(): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "noop", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    } as unknown as ChatCompletionChunk;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requests = [];
    chatHistory = convertToUnifiedHistory([{ role: "user", content: "Hello" }]);
    vi.mocked(services.systemMessage.getSystemMessage)
      .mockResolvedValueOnce("prompt v1")
      .mockResolvedValueOnce("prompt v2")
      .mockResolvedValueOnce("prompt v2");
    let call = 0;
    llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* (
        request: any,
      ) {
        requests.push(request);
        call++;
        if (call < 3) {
          yield toolCallChunk();
        } else {
          yield contentChunk("done");
        }
      }),
    } as unknown as BaseLlmApi;
  });

  it("keeps the original system field and appends a changed prompt after history", async () => {
    await streamChatResponse(chatHistory, model, llmApi, new AbortController());

    expect(requests).toHaveLength(3);
    expect(requests[0].messages[0]).toEqual({
      role: "system",
      content: "prompt v1",
    });
    expect(requests[1].messages[0]).toEqual({
      role: "system",
      content: "prompt v1",
    });
    expect(
      requests[1].messages.filter(
        (message: { role: string }) => message.role === "system",
      ),
    ).toEqual([
      { role: "system", content: "prompt v1" },
      { role: "system", content: "prompt v2" },
    ]);
    expect(
      requests[2].messages.filter(
        (message: { role: string }) => message.role === "system",
      ),
    ).toEqual([
      { role: "system", content: "prompt v1" },
      { role: "system", content: "prompt v2" },
    ]);
  });
});
