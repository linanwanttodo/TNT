import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OVERFLOW_RECOVERIES } from "../loop/terminalStop.js";

import { streamChatResponse } from "./streamChatResponse.js";
import { handlePreApiCompaction } from "./streamChatResponse.compactionHelpers.js";

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(() => false),
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

vi.mock("./handleToolCalls.js", () => ({
  handleToolCalls: vi.fn(() => Promise.resolve(false)),
  getRequestTools: vi.fn(() => Promise.resolve([])),
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

const mockModel = {
  provider: "openai",
  name: "gpt-4",
  model: "gpt-4",
  defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
} as any;

/** What a provider says when the request simply does not fit. */
const OVERFLOW_MESSAGE =
  "400 prompt is too long: 210000 tokens > 200000 maximum";

function contentChunk(content: string): ChatCompletionChunk {
  return {
    id: "test",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "test-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  } as unknown as ChatCompletionChunk;
}

/** Refuses the first round for length, then answers. */
function overflowThenAnswer(): BaseLlmApi {
  let calls = 0;
  return {
    chatCompletionStream: vi.fn().mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        throw new Error(OVERFLOW_MESSAGE);
      }
      yield contentChunk("recovered after shrinking");
    }),
  } as unknown as BaseLlmApi;
}

function alwaysOverflow(): BaseLlmApi {
  return {
    chatCompletionStream: vi
      .fn()
      .mockRejectedValue(new Error(OVERFLOW_MESSAGE)) as any,
  } as unknown as BaseLlmApi;
}

let chatHistory: ChatHistoryItem[];

beforeEach(() => {
  vi.clearAllMocks();
  chatHistory = convertToUnifiedHistory([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Keep going" },
  ]);
});

/**
 * The estimate that gates compaction is local; the provider is the authority.
 * A refusal naming the context window used to end the turn, because retrying
 * the same bytes gets the same answer.
 */
describe("context overflow recovery", () => {
  it("compacts under force and retries the round that was refused", async () => {
    const response = await streamChatResponse(
      chatHistory,
      mockModel,
      overflowThenAnswer(),
      new AbortController(),
      undefined,
      false,
    );

    expect(response).toContain("recovered after shrinking");

    const options = vi
      .mocked(handlePreApiCompaction)
      .mock.calls.map(
        (call) => (call[1] as { force?: boolean }).force ?? false,
      );
    expect(options).toEqual([false, true]);
  });

  it("gives up after the bounded attempts and reports what the provider said", async () => {
    const llmApi = alwaysOverflow();

    await expect(
      streamChatResponse(
        chatHistory,
        mockModel,
        llmApi,
        new AbortController(),
        undefined,
        false,
      ),
    ).rejects.toThrow(/prompt is too long/);

    // One refused round plus the bounded number of shrink-and-resend attempts.
    expect(llmApi.chatCompletionStream).toHaveBeenCalledTimes(
      1 + OVERFLOW_RECOVERIES,
    );
  });
});
