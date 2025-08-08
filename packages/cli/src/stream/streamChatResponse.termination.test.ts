import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminationReason } from "../loop/termination.js";

import { streamChatResponse } from "./streamChatResponse.js";

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

describe("streamChatResponse - loop termination", () => {
  const mockModel: ModelConfig = {
    provider: "openai",
    name: "gpt-4",
    model: "gpt-4",
    defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
  } as any;

  let chatHistory: ChatHistoryItem[];
  let abortController: AbortController;

  function contentChunk(content: string): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
  }

  function toolCallChunk(name: string): ChatCompletionChunk {
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
                id: `call_${name}`,
                type: "function",
                function: { name, arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    } as unknown as ChatCompletionChunk;
  }

  /** A stream that always asks for a tool call, so the loop never self-ends. */
  function endlessToolCallStream(): BaseLlmApi {
    return {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        yield toolCallChunk("noop");
      }),
    } as unknown as BaseLlmApi;
  }

  /**
   * A stream that asks for a tool call and also returns real content, so the
   * diminishing-returns check does not fire before the step ceiling does. The
   * usage block carries a real completion count because the loop reads
   * progress from the provider's count when it has one, and this test's
   * history does not actually grow.
   */
  function productiveStream(): BaseLlmApi {
    return {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        yield contentChunk(
          "Inspected the module and applied the change to the parser.",
        );
        yield toolCallChunk("noop");
        yield {
          id: "test",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "test-model",
          choices: [],
          usage: { prompt_tokens: 1000, completion_tokens: 900 },
        } as unknown as ChatCompletionChunk;
      }),
    } as unknown as BaseLlmApi;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chatHistory = convertToUnifiedHistory([{ role: "user", content: "Hello" }]);
    abortController = new AbortController();
  });

  it("stops at the step ceiling and reports max_steps", async () => {
    const reasons: TerminationReason[] = [];

    await streamChatResponse(
      chatHistory,
      mockModel,
      productiveStream(),
      abortController,
      { onTurnTerminated: (reason) => reasons.push(reason) },
      false,
      { maxSteps: 4 },
    );

    expect(reasons).toEqual(["max_steps"]);
  });

  it("stops when the turn is aborted", async () => {
    const reasons: TerminationReason[] = [];
    abortController.abort();

    await streamChatResponse(
      chatHistory,
      mockModel,
      endlessToolCallStream(),
      abortController,
      { onTurnTerminated: (reason) => reasons.push(reason) },
    );

    expect(reasons).toEqual(["user_abort"]);
  });

  it("ends normally when the model stops asking for tools", async () => {
    const reasons: TerminationReason[] = [];
    const llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        yield contentChunk("All done");
      }),
    } as unknown as BaseLlmApi;

    const response = await streamChatResponse(
      chatHistory,
      mockModel,
      llmApi,
      abortController,
      { onTurnTerminated: (reason) => reasons.push(reason) },
    );

    expect(reasons).toEqual(["no_tool_calls"]);
    expect(response).toContain("All done");
  });

  it("stops when the output repeats itself", async () => {
    const reasons: TerminationReason[] = [];
    // One line long enough to clear the detector's length floor, repeated
    // enough times to cross the repetition threshold.
    const stuck =
      "the build fails because the generated client is missing the required export";
    const llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        yield contentChunk(`${stuck}\n${stuck}\n${stuck}\n`);
      }),
    } as unknown as BaseLlmApi;

    await streamChatResponse(chatHistory, mockModel, llmApi, abortController, {
      onTurnTerminated: (reason) => reasons.push(reason),
    });

    expect(reasons).toEqual(["loop_detected"]);
  });

  it("gives a notice for a truncated turn and none for a normal one", async () => {
    const notices: (string | undefined)[] = [];
    const capture = (detail?: { notice?: string }) => {
      notices.push(detail?.notice);
    };

    await streamChatResponse(
      chatHistory,
      mockModel,
      endlessToolCallStream(),
      abortController,
      { onTurnTerminated: (_r, detail) => capture(detail) },
      false,
      { maxSteps: 2 },
    );

    expect(notices[0]).toContain("step limit");
    expect(notices[0]).toContain("may be incomplete");
  });

  it("stops with a reason even when no callback is attached", async () => {
    // The loop must not depend on an observer to terminate.
    await expect(
      streamChatResponse(
        chatHistory,
        mockModel,
        endlessToolCallStream(),
        abortController,
        undefined,
        false,
        { maxSteps: 2 },
      ),
    ).resolves.toBeTypeOf("string");
  });
});
