import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCachePrefixes } from "../cache/prefixState.js";
import { services } from "../services/index.js";
import { logger } from "../util/logger.js";

import { streamChatResponse } from "./streamChatResponse.js";

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history: ChatHistoryItem[]) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(() => "Auto-compacting..."),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "session-a" })),
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
      getState: vi.fn(() => ({ currentMode: "agent" })),
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
  getRequestTools: vi.fn(() =>
    Promise.resolve([{ function: { name: "Read" } }]),
  ),
}));

vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePreApiCompaction: vi.fn((history: ChatHistoryItem[]) =>
    Promise.resolve({ chatHistory: history, wasCompacted: false }),
  ),
  handlePostToolValidation: vi.fn((_toolCalls, history: ChatHistoryItem[]) =>
    Promise.resolve({ chatHistory: history, wasCompacted: false }),
  ),
  handleNormalAutoCompaction: vi.fn((history: ChatHistoryItem[]) =>
    Promise.resolve({ chatHistory: history, wasCompacted: false }),
  ),
}));

describe("streamChatResponse cache prefix attribution", () => {
  const model = {
    provider: "openai",
    name: "test-model",
    model: "test-model",
    defaultCompletionOptions: {
      contextLength: 8192,
      maxTokens: 2048,
    },
  } as ModelConfig;

  const INPUT_TOKENS = 5000;

  let chatHistory: ChatHistoryItem[];
  let llmApi: BaseLlmApi;

  function answerChunk(): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [{ index: 0, delta: { content: "done" }, finish_reason: null }],
      usage: {
        prompt_tokens: INPUT_TOKENS,
        completion_tokens: 4,
        total_tokens: INPUT_TOKENS + 4,
        prompt_tokens_details: { cache_read_tokens: 0, cache_write_tokens: 0 },
      },
    } as unknown as ChatCompletionChunk;
  }

  function cacheUsageLogs() {
    return vi
      .mocked(logger.info)
      .mock.calls.filter((call) => call[0] === "Request cache usage")
      .map((call) => call[1] as Record<string, unknown>);
  }

  async function runTurn(systemMessage: string) {
    vi.mocked(services.systemMessage.getSystemMessage).mockResolvedValue(
      systemMessage,
    );

    await streamChatResponse(chatHistory, model, llmApi, new AbortController());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    forgetCachePrefixes();
    chatHistory = convertToUnifiedHistory([{ role: "user", content: "Hello" }]);
    llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        yield answerChunk();
      }),
    } as unknown as BaseLlmApi;
  });

  it("labels the first request of a conversation cold", async () => {
    await runTurn("prompt v1");

    expect(cacheUsageLogs()).toEqual([
      expect.objectContaining({ prefixState: "cold" }),
    ]);
  });

  it("reports an unchanged prefix as full across turns", async () => {
    await runTurn("prompt v1");
    await runTurn("prompt v1");

    expect(cacheUsageLogs()[1]).toEqual(
      expect.objectContaining({ prefixState: "full", prefixReasons: [] }),
    );
  });

  it("blames the provider when an identical prefix read nothing", async () => {
    await runTurn("prompt v1");
    await runTurn("prompt v1");

    expect(cacheUsageLogs()[1]).toEqual(
      expect.objectContaining({ cacheMissOwner: "provider" }),
    );
  });

  it("names the system message when it moved between turns", async () => {
    await runTurn("prompt v1");
    await runTurn("prompt v2");

    expect(cacheUsageLogs()[1]).toEqual(
      expect.objectContaining({
        prefixState: "invalidated",
        prefixReasons: ["systemMessage"],
        cacheMissOwner: "prefix",
      }),
    );
  });

  it("stays silent on the miss owner when the cache was read", async () => {
    llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        const chunk = answerChunk();
        (chunk as unknown as { usage: Record<string, unknown> }).usage = {
          prompt_tokens: INPUT_TOKENS,
          completion_tokens: 4,
          total_tokens: INPUT_TOKENS + 4,
          prompt_tokens_details: {
            cache_read_tokens: INPUT_TOKENS - 10,
            cache_write_tokens: 0,
          },
        };
        yield chunk;
      }),
    } as unknown as BaseLlmApi;

    await runTurn("prompt v1");
    await runTurn("prompt v1");

    expect(cacheUsageLogs()[1]).toEqual(
      expect.objectContaining({ prefixState: "full" }),
    );
    expect(cacheUsageLogs()[1]).not.toHaveProperty("cacheMissOwner");
  });
});
