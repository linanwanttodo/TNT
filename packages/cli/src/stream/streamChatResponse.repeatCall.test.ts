import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { RepeatCallGuard } from "../loop/repeatCallGuard.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { executeStreamedToolCalls } from "./streamChatResponse.helpers.js";
import { streamChatResponse } from "./streamChatResponse.js";

const empty = (): Partial<HookEventResult> => ({ blocked: false, results: [] });

const fireHooks = vi.hoisted(() => ({
  firePreToolUse: vi.fn(async (..._args: unknown[]) => empty()),
  firePostToolUse: vi.fn(async (..._args: unknown[]) => empty()),
  firePostToolUseFailure: vi.fn(async (..._args: unknown[]) => empty()),
}));
vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: (...args: unknown[]) => fireHooks.firePreToolUse(...args),
  firePostToolUse: (...args: unknown[]) => fireHooks.firePostToolUse(...args),
  firePostToolUseFailure: (...args: unknown[]) =>
    fireHooks.firePostToolUseFailure(...args),
  firePermissionRequest: vi.fn(async () => empty()),
}));

/** The reminder text the composed callback returned on each tool round. */
const captured = vi.hoisted(() => ({ reminders: [] as string[] }));

vi.mock("./handleToolCalls.js", () => ({
  handleToolCalls: vi.fn(async (options: any) => {
    if (options.toolCalls.length === 0) {
      return false;
    }
    const reminder = options.callbacks?.onTailReminder?.(
      "Read",
      '{"filepath":"/x.txt"}',
    );
    if (reminder) {
      captured.reminders.push(reminder);
    }
    return false;
  }),
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

const allowAll = { policies: [{ tool: "*", permission: "allow" as const }] };

function call(index: number): PreprocessedToolCall {
  return {
    id: `call_${index}`,
    name: "Read",
    arguments: { filepath: "/x.txt" },
    argumentsStr: '{"filepath":"/x.txt"}',
    startNotified: false,
    tool: readFileTool,
  };
}

describe("repeat-call advice", () => {
  beforeEach(async () => {
    captured.reminders.length = 0;
    for (const mock of Object.values(fireHooks)) {
      mock.mockReset();
      mock.mockResolvedValue(empty());
    }
    const toolsModule = await import("../tools/index.js");
    vi.spyOn(toolsModule, "executeToolCall").mockResolvedValue("file body");
  });

  it("composes the guard's advice into the tail reminder the tool result receives", async () => {
    const mockModel: ModelConfig = {
      provider: "openai",
      name: "gpt-4",
      model: "gpt-4",
      defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
    } as any;
    const chatHistory: ChatHistoryItem[] = convertToUnifiedHistory([
      { role: "user", content: "Hello" },
    ]);
    const abortController = new AbortController();
    let rounds = 0;
    const llmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        rounds += 1;
        const chunk =
          rounds <= 5
            ? {
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
                          id: `call_${rounds}`,
                          type: "function",
                          function: { name: "Read", arguments: "{}" },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              }
            : {
                id: "test",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Done" },
                    finish_reason: null,
                  },
                ],
              };
        yield chunk as unknown as ChatCompletionChunk;
      }),
    } as unknown as BaseLlmApi;

    await streamChatResponse(chatHistory, mockModel, llmApi, abortController);

    // The third and fifth identical rounds produced advice, and both reached
    // the callback that tool dispatch appends to the result.
    expect(captured.reminders).toHaveLength(2);
    expect(captured.reminders[0]).toContain("Read");
    expect(captured.reminders[0]).toContain("3 times in a row");
    expect(captured.reminders[1]).toContain("5 times in a row");
    expect(captured.reminders[1]).toContain("filepath");
  });

  it("places the advice inside the tool result content the model reads", async () => {
    const guard = new RepeatCallGuard();
    const contents: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const { chatHistoryEntries } = await executeStreamedToolCalls(
        [call(index)],
        {
          onTailReminder: (toolName, argumentsJson) =>
            guard.record(toolName, argumentsJson),
        },
        false,
        undefined,
        { permissions: allowAll },
      );
      contents.push(String(chatHistoryEntries[0]?.content));
    }

    expect(contents[0]).not.toContain("identical arguments");
    expect(contents[1]).not.toContain("identical arguments");
    expect(contents[2]).toContain("identical arguments");
    expect(contents[2]).toContain("<system-reminder>");
    expect(contents[2]).toContain("file body");
  });
});
