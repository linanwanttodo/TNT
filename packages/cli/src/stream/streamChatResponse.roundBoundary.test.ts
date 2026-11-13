import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { streamChatResponse } from "./streamChatResponse.js";

const empty = (): Partial<HookEventResult> => ({ blocked: false, results: [] });

vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: vi.fn(async () => empty()),
  firePostToolUse: vi.fn(async () => empty()),
  firePostToolUseFailure: vi.fn(async () => empty()),
  firePermissionRequest: vi.fn(async () => empty()),
}));

vi.mock("./handleToolCalls.js", () => ({
  handleToolCalls: vi.fn(async (options: any) =>
    options.toolCalls.length === 0 ? false : false,
  ),
  getRequestTools: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history) => history.slice(0, -1)),
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
  getModelContextLimit: vi.fn(() => 200_000),
  getModelMaxTokens: vi.fn(() => 70_000),
  countToolDefinitionTokens: vi.fn(() => 50),
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
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: {
      getSystemMessage: vi.fn(() => Promise.resolve("System message")),
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

vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePreApiCompaction: vi.fn((chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handlePostToolValidation: vi.fn((_, chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handleNormalAutoCompaction: vi.fn((chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
}));

function call(): PreprocessedToolCall {
  return {
    id: "call_1",
    name: "Read",
    arguments: { filepath: "/x.txt" },
    argumentsStr: '{"filepath":"/x.txt"}',
    startNotified: false,
    tool: readFileTool,
  };
}

function chunkWithToolCall(): ChatCompletionChunk {
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
              function: { name: "Read", arguments: "{}" },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  } as unknown as ChatCompletionChunk;
}

function chunkWithAnswer(): ChatCompletionChunk {
  return {
    id: "test",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "test-model",
    choices: [{ index: 0, delta: { content: "Done" }, finish_reason: null }],
  } as unknown as ChatCompletionChunk;
}

describe("round-boundary delivery", () => {
  it("offers the boundary after a tool round and not after the final answer", async () => {
    const model: ModelConfig = {
      provider: "openai",
      name: "gpt-4",
      model: "gpt-4",
      defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
    } as any;
    const history: ChatHistoryItem[] = convertToUnifiedHistory([
      { role: "user", content: "Hello" },
    ]);
    let rounds = 0;
    const llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        rounds += 1;
        yield rounds === 1 ? chunkWithToolCall() : chunkWithAnswer();
      }),
    } as unknown as BaseLlmApi;

    const onRoundBoundary = vi.fn(async () => false);
    await streamChatResponse(history, model, llmApi, new AbortController(), {
      onRoundBoundary,
    });

    // One tool round continued the turn; the answer round ended it, so only
    // the continuing boundary is a place a queued message may be injected.
    expect(onRoundBoundary).toHaveBeenCalledTimes(1);
  });

  it("waits for a continuing round even when the boundary appends nothing", async () => {
    const model: ModelConfig = {
      provider: "openai",
      name: "gpt-4",
      model: "gpt-4",
      defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
    } as any;
    const history: ChatHistoryItem[] = convertToUnifiedHistory([
      { role: "user", content: "Hello" },
    ]);
    let rounds = 0;
    const llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        rounds += 1;
        yield rounds <= 2 ? chunkWithToolCall() : chunkWithAnswer();
      }),
    } as unknown as BaseLlmApi;

    let calls = 0;
    await streamChatResponse(history, model, llmApi, new AbortController(), {
      onRoundBoundary: async () => ++calls === 1,
    });

    expect(calls).toBe(2);
    expect(rounds).toBe(3);
  });
});

// Keeps the imported tool name referenced for the mock factory above.
void call;
