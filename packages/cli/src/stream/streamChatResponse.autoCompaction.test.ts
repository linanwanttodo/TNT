import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { TOOL_RESULT_TRUNCATION_MARKER } from "core/util/toolResultCompaction.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSessionState = vi.hoisted(() => ({
  generation: 0,
  session: { sessionId: "test-session", history: [] as any[] },
}));

import { handleAutoCompaction } from "./streamChatResponse.autoCompaction.js";

// Mock dependencies
vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(),
  findCompactionIndex: vi.fn(() => null),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => mockSessionState.session),
  getSessionHistoryGeneration: vi.fn(() => mockSessionState.generation),
  replaceSessionHistoryIfGeneration: vi.fn((expectedGeneration, history) => {
    if (mockSessionState.generation !== expectedGeneration) {
      return false;
    }
    mockSessionState.session.history = history;
    mockSessionState.generation++;
    return true;
  }),
  createSession: vi.fn((history) => ({
    sessionId: "test",
    title: "Test",
    workspaceDirectory: "/test",
    history,
  })),
  saveSession: vi.fn(),
  updateSessionHistory: vi.fn(),
  trackSessionUsage: vi.fn(),
}));

vi.mock("../utils/tokenizer.js", () => ({
  countChatHistoryItemTokens: vi.fn(() => 100), // Mock return value
}));

vi.mock("../utils/formatError.js", () => ({
  formatError: vi.fn((error) => error.message || String(error)),
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
    },
  },
}));

vi.mock("os", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    homedir: vi.fn(() => "/home/test"),
  };
});

describe("handleAutoCompaction", () => {
  const mockModel = {
    provider: "openai",
    name: "gpt-4",
    model: "gpt-4",
    defaultCompletionOptions: {
      contextLength: 8192,
      maxTokens: 2048,
    },
  } as any;

  const mockLlmApi = {} as any;
  const mockChatHistory: ChatHistoryItem[] = convertToUnifiedHistory([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionState.generation = 0;
    mockSessionState.session = { sessionId: "test-session", history: [] };
  });

  it("should return original history when auto-compaction is not needed", async () => {
    const { shouldAutoCompact } = await import("../compaction/index.js");
    const mockedShouldAutoCompact = shouldAutoCompact as any;
    mockedShouldAutoCompact.mockReturnValue(false);

    const result = await handleAutoCompaction(
      mockChatHistory,
      mockModel,
      mockLlmApi,
      {},
    );

    expect(result).toEqual({
      chatHistory: mockChatHistory,
      compactionIndex: null,
      wasCompacted: false,
    });

    expect(shouldAutoCompact).toHaveBeenCalledWith({
      chatHistory: mockChatHistory,
      model: mockModel,
      systemMessage: undefined,
      tools: undefined,
    });
  });

  it("compacts when the caller forces it, without consulting the threshold", async () => {
    const { compactChatHistory, getAutoCompactMessage, shouldAutoCompact } =
      await import("../compaction/index.js");

    vi.mocked(shouldAutoCompact).mockReturnValue(false);
    vi.mocked(getAutoCompactMessage).mockReturnValue("Compacting...");
    vi.mocked(compactChatHistory).mockResolvedValue({
      compactedHistory: convertToUnifiedHistory([
        { role: "system", content: "[COMPACTED HISTORY]" },
      ]),
      compactionIndex: 0,
      compactionContent: "[COMPACTED HISTORY]",
    } as any);

    const result = await handleAutoCompaction(
      mockChatHistory,
      mockModel,
      mockLlmApi,
      { force: true },
    );

    // The provider refusing for length is the evidence; the local estimate that
    // said it fit is what is being overridden.
    expect(result.wasCompacted).toBe(true);
    expect(compactChatHistory).toHaveBeenCalled();
    expect(shouldAutoCompact).not.toHaveBeenCalled();
  });

  it("should perform auto-compaction when context limit is approaching", async () => {
    const { compactChatHistory, shouldAutoCompact, getAutoCompactMessage } =
      await import("../compaction/index.js");
    const { replaceSessionHistoryIfGeneration } = await import(
      "../session/index.js"
    );

    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(getAutoCompactMessage).mockReturnValue("Auto-compacting...");

    const mockCompactionResult = {
      compactedHistory: convertToUnifiedHistory([
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "assistant",
          content: "[COMPACTED HISTORY]\nConversation summary...",
        },
      ]),
      compactionIndex: 1,
      compactionContent: "Conversation summary...",
    };

    const mockedCompactChatHistory = compactChatHistory as any;
    mockedCompactChatHistory.mockResolvedValue(mockCompactionResult);

    const mockCallbacks = {
      onSystemMessage: vi.fn(),
    };

    const result = await handleAutoCompaction(
      mockChatHistory,
      mockModel,
      mockLlmApi,
      {
        isHeadless: false,
        callbacks: mockCallbacks,
      },
    );

    expect(shouldAutoCompact).toHaveBeenCalledWith({
      chatHistory: mockChatHistory,
      model: mockModel,
      systemMessage: undefined,
      tools: undefined,
    });
    expect(getAutoCompactMessage).toHaveBeenCalledWith(mockModel);
    expect(compactChatHistory).toHaveBeenCalledWith(
      mockChatHistory,
      mockModel,
      mockLlmApi,
      expect.objectContaining({
        callbacks: expect.any(Object),
        systemMessageTokens: expect.any(Number),
      }),
    );
    expect(replaceSessionHistoryIfGeneration).toHaveBeenCalledWith(
      0,
      mockCompactionResult.compactedHistory,
    );

    expect(mockCallbacks.onSystemMessage).toHaveBeenCalledWith(
      "Auto-compacting...",
    );
    expect(mockCallbacks.onSystemMessage).toHaveBeenCalledWith(
      "Chat history auto-compacted successfully.",
    );

    expect(result).toEqual({
      chatHistory: mockCompactionResult.compactedHistory,
      compactionIndex: mockCompactionResult.compactionIndex,
      wasCompacted: true,
    });
  });

  it("persists tool-result pruning without summarizing when it clears the threshold", async () => {
    const { compactChatHistory, shouldAutoCompact } = await import(
      "../compaction/index.js"
    );
    const { replaceSessionHistoryIfGeneration } = await import(
      "../session/index.js"
    );
    const body = "0123456789abcdef".repeat(400);
    const history: ChatHistoryItem[] = Array.from({ length: 6 }, (_, index) => {
      const id = `call-${index}`;
      return {
        message: { role: "assistant", content: "" },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: id,
            toolCall: {
              id,
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
            status: "done",
            parsedArgs: {},
            output: [
              {
                content: index === 0 ? body : `recent-${index}`,
                name: "Tool Result: read_file",
                description: "Tool execution result",
              },
            ],
          },
        ],
      };
    });
    vi.mocked(shouldAutoCompact).mockImplementation(
      ({ chatHistory }) =>
        !chatHistory[0].toolCallStates?.[0].output?.[0].content.includes(
          TOOL_RESULT_TRUNCATION_MARKER,
        ),
    );
    const callbacks = {
      setChatHistory: vi.fn(),
      setCompactionIndex: vi.fn(),
    };

    const result = await handleAutoCompaction(history, mockModel, mockLlmApi, {
      callbacks,
    });

    expect(compactChatHistory).not.toHaveBeenCalled();
    expect(result.wasCompacted).toBe(true);
    expect(
      result.chatHistory[0].toolCallStates?.[0].output?.[0].content,
    ).toContain(TOOL_RESULT_TRUNCATION_MARKER);
    expect(replaceSessionHistoryIfGeneration).toHaveBeenCalledWith(
      0,
      result.chatHistory,
    );
    expect(callbacks.setChatHistory).toHaveBeenCalledWith(result.chatHistory);
    expect(callbacks.setCompactionIndex).toHaveBeenCalledWith(null);
  });

  it("opens the failure breaker after three summary failures", async () => {
    const { compactChatHistory, shouldAutoCompact } = await import(
      "../compaction/index.js"
    );
    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(compactChatHistory).mockRejectedValue(
      new Error("summary failed"),
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);
    }
    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);

    expect(compactChatHistory).toHaveBeenCalledTimes(3);
  });

  it("does not count a persisted tool-result prune as a summary failure", async () => {
    const { compactChatHistory, shouldAutoCompact } = await import(
      "../compaction/index.js"
    );
    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(compactChatHistory).mockRejectedValue(
      new Error("summary failed"),
    );

    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);
    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);

    const largeOutput = "0123456789abcdef".repeat(400);
    const history: ChatHistoryItem[] = Array.from({ length: 6 }, (_, index) => {
      const id = `call-${index}`;
      return {
        message: { role: "assistant", content: "" },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: id,
            toolCall: {
              id,
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
            status: "done",
            parsedArgs: {},
            output: [
              {
                content: index === 0 ? largeOutput : `recent-${index}`,
                name: "Tool Result: read_file",
                description: "Tool execution result",
              },
            ],
          },
        ],
      };
    });

    const pruningAttempt = await handleAutoCompaction(
      history,
      mockModel,
      mockLlmApi,
    );
    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);
    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi);

    expect(pruningAttempt.wasCompacted).toBe(true);
    expect(compactChatHistory).toHaveBeenCalledTimes(4);
  });

  it("does not overwrite a newer history when the summary returns late", async () => {
    const { compactChatHistory, shouldAutoCompact } = await import(
      "../compaction/index.js"
    );
    const { replaceSessionHistoryIfGeneration } = await import(
      "../session/index.js"
    );
    const latestHistory: ChatHistoryItem[] = [
      {
        message: { role: "user", content: "Message added during summary" },
        contextItems: [],
      },
    ];
    mockSessionState.session.history = latestHistory;
    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(replaceSessionHistoryIfGeneration).mockReturnValueOnce(false);
    vi.mocked(compactChatHistory).mockResolvedValue({
      compactedHistory: [
        {
          message: { role: "assistant", content: "Stale summary" },
          contextItems: [],
        },
      ],
      compactionIndex: 0,
      compactionContent: "Stale summary",
    });

    const result = await handleAutoCompaction(
      mockChatHistory,
      mockModel,
      mockLlmApi,
    );

    expect(result.chatHistory).toBe(latestHistory);
    expect(result.wasCompacted).toBe(false);
  });

  it("should handle compaction errors gracefully", async () => {
    const { compactChatHistory, shouldAutoCompact, getAutoCompactMessage } =
      await import("../compaction/index.js");
    const { logger } = await import("../utils/logger.js");

    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(getAutoCompactMessage).mockReturnValue("Auto-compacting...");
    vi.mocked(compactChatHistory).mockRejectedValue(
      new Error("Compaction failed"),
    );

    const mockCallbacks = {
      onSystemMessage: vi.fn(),
    };

    const result = await handleAutoCompaction(
      mockChatHistory,
      mockModel,
      mockLlmApi,
      {
        isHeadless: false,
        callbacks: mockCallbacks,
      },
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Auto-compaction error"),
    );
    expect(mockCallbacks.onSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Warning: Auto-compaction error"),
    );

    // Should return original history on error
    expect(result.wasCompacted).toBe(false);
    expect(result).toEqual({
      chatHistory: mockChatHistory,
      compactionIndex: null,
      wasCompacted: false,
    });
  });

  it("should not call system message callback in headless mode", async () => {
    const { compactChatHistory, shouldAutoCompact, getAutoCompactMessage } =
      await import("../compaction/index.js");

    vi.mocked(shouldAutoCompact).mockReturnValue(true);
    vi.mocked(getAutoCompactMessage).mockReturnValue("Auto-compacting...");

    const mockCompactionResult = {
      compactedHistory: convertToUnifiedHistory([
        { role: "system", content: "System" },
      ]),
      compactionIndex: 0,
      compactionContent: "Summary",
    };

    const mockedCompactChatHistory = compactChatHistory as any;
    mockedCompactChatHistory.mockResolvedValue(mockCompactionResult);

    const mockCallbacks = {
      onSystemMessage: vi.fn(),
    };

    await handleAutoCompaction(mockChatHistory, mockModel, mockLlmApi, {
      isHeadless: true,
      callbacks: mockCallbacks,
    });

    expect(mockCallbacks.onSystemMessage).not.toHaveBeenCalled();
  });

  it("should handle missing model gracefully", async () => {
    const result = await handleAutoCompaction(
      mockChatHistory,
      null as any,
      mockLlmApi,
      {},
    );

    expect(result).toEqual({
      chatHistory: mockChatHistory,
      compactionIndex: null,
      wasCompacted: false,
    });
  });
});
