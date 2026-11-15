import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cachePrefixKeys, forgetCachePrefixes } from "../cache/prefixState.js";
import { services } from "../services/index.js";

import { streamChatResponse } from "./streamChatResponse.js";
import { resetSystemPromptSeries } from "./systemPromptSeries.js";

const handles = vi.hoisted(() => ({
  rounds: 0,
  getRequestTools: vi.fn(),
}));

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history: ChatHistoryItem[]) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(() => "Auto-compacting..."),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "prefix-stability" })),
  updateSessionHistory: vi.fn(),
  trackSessionUsage: vi.fn(),
}));

vi.mock("../utils/tokenizer.js", () => ({
  getModelMaxTokens: vi.fn(() => 70_000),
  getModelContextLimit: vi.fn(() => 200_000),
  countToolDefinitionTokens: vi.fn(() => 50),
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
      getSystemMessageSections: vi.fn(),
    },
    toolPermissions: {
      getState: vi.fn(() => ({ currentMode: "default" })),
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
  handleToolCalls: vi.fn(
    async ({
      chatHistory,
    }: {
      chatHistory: ChatHistoryItem[];
    }): Promise<boolean> => {
      handles.rounds += 1;
      chatHistory.push({
        message: {
          role: "assistant",
          content: `answer ${handles.rounds}`,
        },
        contextItems: [],
      });
      // False means "no early stop"; the loop continues while the stream
      // keeps asking for tools.
      return false;
    },
  ),
  getRequestTools: handles.getRequestTools,
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

interface Section {
  name: string;
  text: string;
}

describe("prompt prefix stability across rounds", () => {
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
  let requests: any[];

  function contentChunk(content: string): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
      usage: {
        prompt_tokens: 5000,
        completion_tokens: 4,
        total_tokens: 5004,
      },
    } as unknown as ChatCompletionChunk;
  }

  function stageSections(build: (round: number) => Section[]): void {
    let call = 0;
    vi.mocked(
      services.systemMessage.getSystemMessageSections,
    ).mockImplementation(async () => {
      call += 1;
      return build(call).map((section) => ({ ...section, volatile: true }));
    });
    vi.mocked(services.systemMessage.getSystemMessage).mockResolvedValue(
      'BASE\n\n<context name="userRules">\nPREAMBLE\n</context>',
    );
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
      usage: {
        prompt_tokens: 5000,
        completion_tokens: 4,
        total_tokens: 5004,
      },
    } as unknown as ChatCompletionChunk;
  }

  function makeApi(): BaseLlmApi {
    let call = 0;
    return {
      // This dialect carries an in-history update, which is what lets the
      // section planner restate a delta instead of rewriting the prefix.
      carriesInHistorySystemMessages: () => true,
      chatCompletionStream: vi.fn().mockImplementation(async function* (
        request: any,
      ) {
        requests.push(request);
        call += 1;
        // Two tool rounds grow the history, the third closes the turn.
        yield call < 3 ? toolCallChunk() : contentChunk("done");
      }),
    } as unknown as BaseLlmApi;
  }

  const systemOf = (request: any): string => request.messages[0].content;

  function hashesOf(request: any) {
    return cachePrefixKeys({
      model: request.model,
      systemMessage: systemOf(request),
      tools: request.tools,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    forgetCachePrefixes();
    resetSystemPromptSeries("tnt-prefix-stability");
    handles.rounds = 0;
    requests = [];
    handles.getRequestTools.mockResolvedValue([{ function: { name: "Read" } }]);
    chatHistory = convertToUnifiedHistory([{ role: "user", content: "Hello" }]);
  });

  it("holds the serialized system and tool hashes across a round with no user action", async () => {
    // The environment is the one volatile section a long-running process can
    // still see move. It must not reach the system field: only the message
    // that carries it may change.
    stageSections((round) => [
      { name: "base", text: "BASE" },
      { name: "userRules", text: '\n\n<context name="userRules">\nPREAMBLE' },
      { name: "userRules:end", text: "\n</context>" },
      { name: "environment", text: `\n\n<env>snapshot ${round}</env>` },
    ]);

    await streamChatResponse(
      chatHistory,
      model,
      makeApi(),
      new AbortController(),
    );

    expect(requests).toHaveLength(3);
    const hashes = requests.map(hashesOf);
    expect(new Set(hashes.map((entry) => entry.system)).size).toBe(1);
    expect(new Set(hashes.map((entry) => entry.tools)).size).toBe(1);

    // One system field per request, and the environment rides the first user
    // message instead.
    for (const request of requests) {
      expect(
        request.messages.filter(
          (message: { role: string }) => message.role === "system",
        ),
      ).toHaveLength(1);
      expect(systemOf(request)).not.toContain("<env>");
      expect(request.messages[1].content).toContain("<env>snapshot");
    }
  });

  it("keeps an in-history section delta where it was produced", async () => {
    stageSections((round) => [
      { name: "base", text: "BASE" },
      { name: "userRules", text: '\n\n<context name="userRules">\nPREAMBLE' },
      {
        name: "userRules:cli:0",
        text: `\n\nRULE ${round === 1 ? "v1" : "v2"}`,
      },
      { name: "userRules:end", text: "\n</context>" },
      { name: "environment", text: "\n\n<env>steady</env>" },
    ]);

    await streamChatResponse(
      chatHistory,
      model,
      makeApi(),
      new AbortController(),
    );

    expect(requests).toHaveLength(3);
    // Round two restates the edited rule as a user-role fragment; round three
    // must still show that fragment at the same offset, so every byte of the
    // round-two request survives at the head of round three.
    expect(requests[1].messages.at(-1)).toEqual({
      role: "user",
      content: "<system-update>\nRULE v2\n</system-update>",
    });
    expect(requests[2].messages.slice(0, requests[1].messages.length)).toEqual(
      requests[1].messages,
    );
    // The system field never carries the changed rule; it keeps the bytes the
    // first round sent.
    expect(systemOf(requests[2])).toBe(systemOf(requests[0]));
    expect(systemOf(requests[2])).toContain("RULE v1");
  });

  it("computes the tool array once for the whole turn", async () => {
    stageSections(() => [{ name: "base", text: "BASE" }]);

    await streamChatResponse(
      chatHistory,
      model,
      makeApi(),
      new AbortController(),
    );

    expect(requests.length).toBeGreaterThan(1);
    expect(handles.getRequestTools).toHaveBeenCalledTimes(1);
  });
});
