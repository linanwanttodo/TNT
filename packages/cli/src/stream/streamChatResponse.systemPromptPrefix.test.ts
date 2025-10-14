import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";
import { logger } from "../utils/logger.js";

import { streamChatResponse } from "./streamChatResponse.js";

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history: ChatHistoryItem[]) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(() => "Auto-compacting..."),
}));

vi.mock("../session/index.js", () => ({
  updateSessionHistory: vi.fn(),
  trackSessionUsage: vi.fn(),
}));

vi.mock("../utils/tokenizer.js", () => ({
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

vi.mock("../utils/logger.js", () => ({
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

  describe("what the prefix rewrite costs", () => {
    const plainModel = {
      provider: "openai",
      name: "test-model",
      model: "test-model",
      defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
    } as ModelConfig;

    function apiWithoutCapability(requests: any[]): BaseLlmApi {
      let call = 0;
      return {
        chatCompletionStream: vi.fn().mockImplementation(async function* (
          request: any,
        ) {
          requests.push(request);
          call++;
          yield call < 3 ? toolCallChunk() : contentChunk("done");
        }),
      } as unknown as BaseLlmApi;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    /**
     * The outer fixture already staged three prompts, so a test that wants its own
     * texts has to take the queue over rather than append to it.
     */
    function stagePrompts(...prompts: string[]): void {
      const get = vi.mocked(services.systemMessage.getSystemMessage);
      get.mockReset();
      prompts
        .slice(0, -1)
        .forEach((prompt) => get.mockResolvedValueOnce(prompt));
      get.mockResolvedValue(prompts[prompts.length - 1]);
    }

    it("names the part of the prompt that had to be rebilled", async () => {
      const requests: any[] = [];
      chatHistory = convertToUnifiedHistory([
        { role: "user", content: "Hello" },
      ]);
      stagePrompts(
        `base\n<context name="userRules">\nkeep paths short\n</context>`,
        `base\n<context name="userRules">\nkeep paths absolute\n</context>`,
      );

      await streamChatResponse(
        chatHistory,
        plainModel,
        apiWithoutCapability(requests),
        new AbortController(),
      );

      // "systemMessage changed" is not something a user can act on; the part that
      // moved is, because the rules are their own file.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("userRules rewritten"),
      );
    });

    it("says so when an append is forced onto a dialect that would drop it", async () => {
      const requests: any[] = [];
      chatHistory = convertToUnifiedHistory([
        { role: "user", content: "Hello" },
      ]);
      vi.mocked(services.systemMessage.getSystemMessage)
        .mockResolvedValueOnce("prompt v1")
        .mockResolvedValueOnce("prompt v2");

      await streamChatResponse(
        chatHistory,
        {
          ...plainModel,
          chatOptions: { supportsInHistorySystemUpdates: true },
        } as ModelConfig,
        apiWithoutCapability(requests),
        new AbortController(),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("may be dropped by the provider"),
      );
    });
  });
});
