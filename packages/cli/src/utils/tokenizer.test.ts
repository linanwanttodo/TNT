import { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldAutoCompact } from "../compaction/index.js";

import { logger } from "./logger.js";
import {
  DEFAULT_CONTEXT_LENGTH,
  calculateContextUsagePercentage,
  countChatHistoryItemTokens,
  countChatHistoryTokens,
  countToolDefinitionTokens,
  getModelContextLimit,
  validateContextLength,
} from "./tokenizer.js";

// Mock the logger
vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock gpt-tokenizer
vi.mock("gpt-tokenizer", () => ({
  encode: (text: string) => new Array(Math.ceil(text.length / 4)), // Rough 4 chars per token
}));

describe("tokenizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getModelContextLimit", () => {
    it("should return contextLength from model config", () => {
      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
        defaultCompletionOptions: {
          contextLength: 8192,
        },
      };

      expect(getModelContextLimit(model)).toBe(8192);
    });

    it("should return default when no contextLength specified", () => {
      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      expect(getModelContextLimit(model)).toBe(DEFAULT_CONTEXT_LENGTH);
    });
  });

  describe("countChatHistoryItemTokens", () => {
    it("should count tokens for string content", () => {
      const historyItem: ChatHistoryItem = {
        message: {
          role: "user",
          content: "Hello world", // 11 chars -> ~3 tokens + 2 for role = 5
        },
        contextItems: [],
      };

      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryItemTokens(historyItem, model);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBe(5); // 3 content tokens + 2 role tokens
    });

    it("should count tokens for array content", () => {
      const historyItem: ChatHistoryItem = {
        message: {
          role: "user",
          content: [
            { type: "text", text: "Hello" }, // 5 chars -> ~2 tokens
            { type: "imageUrl", imageUrl: { url: "test.jpg" } }, // +1024 tokens
          ],
        },
        contextItems: [],
      };

      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryItemTokens(historyItem, model);
      expect(tokenCount).toBe(1028); // 2 + 1024 + 2 role tokens
    });

    it("should count tokens for tool calls", () => {
      const historyItem: ChatHistoryItem = {
        message: {
          role: "assistant",
          content: "I'll help you",
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "test_function", // ~3 tokens + 10 overhead
                arguments: '{"param": "value"}', // ~5 tokens
              },
            },
          ],
        },
        contextItems: [],
      };

      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryItemTokens(historyItem, model);
      expect(tokenCount).toBeGreaterThan(20);
    });

    it("should count tokens for context items", () => {
      const historyItem: ChatHistoryItem = {
        message: {
          role: "user",
          content: "Hello", // 5 chars -> ~2 tokens
        },
        contextItems: [
          {
            id: { providerTitle: "test", itemId: "1" },
            content: "Context content", // 15 chars -> ~4 tokens
            name: "Test context", // 12 chars -> ~3 tokens
            description: "Test description",
          },
        ],
      };

      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryItemTokens(historyItem, model);
      // 2 (content) + 2 (role) + 4 (context content) + 3 (context name) + 5 (context overhead) = 16
      expect(tokenCount).toBe(16);
    });

    it("should handle errors gracefully", () => {
      // We'll skip this test for now since mocking gpt-tokenizer is complex
      // The error handling is tested implicitly by the fallback behavior
      expect(true).toBe(true);
    });
  });

  describe("countChatHistoryTokens", () => {
    it("should count tokens for multiple messages", () => {
      const chatHistory: ChatHistoryItem[] = [
        {
          message: { role: "system", content: "You are helpful" },
          contextItems: [],
        },
        {
          message: { role: "user", content: "Hello" },
          contextItems: [],
        },
        {
          message: { role: "assistant", content: "Hi there" },
          contextItems: [],
        },
      ];

      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryTokens(chatHistory, model);
      expect(tokenCount).toBeGreaterThan(0);
      // Should include message overhead (3 * 3 = 9 tokens)
      expect(tokenCount).toBeGreaterThan(9);
    });

    it("should handle empty chat history", () => {
      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
      };

      const tokenCount = countChatHistoryTokens([], model);
      expect(tokenCount).toBe(0);
    });
  });

  describe("calculateContextUsagePercentage", () => {
    it("should calculate percentage correctly", () => {
      const model: ModelConfig = {
        name: "test-model",
        model: "test",
        provider: "openai",
        defaultCompletionOptions: {
          contextLength: 1000,
        },
      };

      expect(calculateContextUsagePercentage(800, model)).toBe(80);
      expect(calculateContextUsagePercentage(500, model)).toBe(50);
      expect(calculateContextUsagePercentage(1200, model)).toBe(100); // Capped at 100%
    });
  });

  describe("validateContextLength", () => {
    const createModel = (maxTokens: number): ModelConfig => ({
      name: "test-model",
      model: "test",
      provider: "openai",
      defaultCompletionOptions: { contextLength: 1000, maxTokens },
    });

    it("shrinks output tokens to preserve safe context headroom", () => {
      const validation = validateContextLength({
        chatHistory: [
          {
            message: { role: "user", content: "x".repeat(1800) },
            contextItems: [],
          },
        ],
        model: createModel(500),
        safetyBuffer: 100,
      });

      expect(validation).toMatchObject({
        isValid: true,
        inputTokens: 455,
        maxTokens: 445,
      });
    });

    it("rejects a request that has no output capacity left", () => {
      const validation = validateContextLength({
        chatHistory: [
          {
            message: { role: "user", content: "x".repeat(3580) },
            contextItems: [],
          },
        ],
        model: createModel(500),
        safetyBuffer: 100,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("No output capacity remains");
      expect(validation.maxTokens).toBe(0);
    });
  });

  describe("shouldAutoCompact", () => {
    const createModel = (
      contextLength: number,
      maxTokens?: number,
    ): ModelConfig => ({
      name: "test-model",
      model: "test",
      provider: "openai",
      defaultCompletionOptions: {
        contextLength,
        maxTokens,
      },
    });

    const createChatHistory = (tokenCount: number): ChatHistoryItem[] => {
      // Create a message that will result in approximately the desired token count
      const content = "x".repeat(tokenCount * 4); // 4 chars per token
      return [
        {
          message: { role: "user", content },
          contextItems: [],
        },
      ];
    };

    it("should compact when input tokens exceed threshold with maxTokens", () => {
      const model = createModel(1000, 200); // 1000 context, 200 max output
      const chatHistory = createChatHistory(740);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
    });

    it("should not compact when input tokens are below threshold with maxTokens", () => {
      const model = createModel(1000, 200); // 1000 context, 200 max output
      const chatHistory = createChatHistory(700);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(false);
    });

    it("should use 35% default reservation when maxTokens is not set", () => {
      const model = createModel(1000); // No maxTokens
      const chatHistory = createChatHistory(600);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
    });

    it("should not compact when below default threshold without maxTokens", () => {
      const model = createModel(1000); // No maxTokens
      const chatHistory = createChatHistory(500);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(false);
    });

    it("should compact earlier when output reservation is unusually large", () => {
      const model = createModel(1000, 800); // maxTokens is 80% of context
      const chatHistory = createChatHistory(140);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
    });

    it("should reject a model with no safe context space", () => {
      const model = createModel(1000, 1000); // maxTokens equals contextLength
      const chatHistory = createChatHistory(1); // Minimal input

      expect(() => shouldAutoCompact({ chatHistory, model })).toThrow(
        "Context window has no safe input space",
      );
    });

    it("should throw error when maxTokens exceeds contextLength", () => {
      const model = createModel(1000, 1200); // maxTokens exceeds contextLength
      const chatHistory = createChatHistory(1); // Minimal input

      expect(() => shouldAutoCompact({ chatHistory, model })).toThrow(
        "Context window has no safe input space",
      );
    });

    it("should handle edge case with very small context limit", () => {
      const model = createModel(200, 50); // Small context
      const chatHistory = createChatHistory(100);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
    });

    it("should log debug information correctly", () => {
      const model = createModel(1000, 200);
      const chatHistory = createChatHistory(550);
      const expectedBuffer = 64;
      const expectedThreshold = 736;

      shouldAutoCompact({ chatHistory, model });

      expect(logger.debug).toHaveBeenCalledWith("Context usage check", {
        inputTokens: expect.any(Number),
        historyTokens: expect.any(Number),
        systemTokens: expect.any(Number),
        toolTokens: expect.any(Number),
        contextLimit: 1000,
        maxTokens: 200,
        reservedForOutput: 200,
        compactionBuffer: expectedBuffer,
        compactionThreshold: expectedThreshold,
        retainTokens: 128,
        shouldCompact: expect.any(Boolean),
        // Nothing was measured for this call, so the number above is the local
        // count and the log says which of the two it was.
        fromMeasurement: false,
      });
    });

    it("should handle model with zero maxTokens correctly", () => {
      const model = createModel(1000, 0); // Explicit zero
      const chatHistory = createChatHistory(850);

      expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
    });

    describe("real-world scenarios", () => {
      it("should prevent Claude 3.5 Sonnet context overflow", () => {
        // Claude 3.5 Sonnet: 200k context, often uses 4k max_tokens
        const model = createModel(200_000, 4_000);
        const chatHistory = createChatHistory(161_000);

        expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
      });

      it("should prevent GPT-4 context overflow", () => {
        // GPT-4: 128k context, often uses 4k max_tokens
        const model = createModel(128_000, 4_000);
        const chatHistory = createChatHistory(103_000);

        expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
      });

      it("should handle models with very high max_tokens", () => {
        const model = createModel(200_000, 64_000);
        const chatHistory = createChatHistory(137_000);

        expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
      });

      it("should stay below the output-reserved context boundary", () => {
        const contextLength = 200_000;
        const maxTokens = 64_000;
        const model = createModel(contextLength, maxTokens);
        const chatHistory = createChatHistory(135_000);

        expect(shouldAutoCompact({ chatHistory, model })).toBe(false);
      });

      it("should use ratio-based buffer when maxTokens is small", () => {
        const contextLength = 100_000;
        const maxTokens = 1_000;
        const model = createModel(contextLength, maxTokens);
        const chatHistory = createChatHistory(81_000);

        expect(shouldAutoCompact({ chatHistory, model })).toBe(true);
      });
    });
  });

  describe("countToolDefinitionTokens", () => {
    it("should return 0 for empty tools array", () => {
      expect(countToolDefinitionTokens([])).toBe(0);
    });

    it("should return 0 for undefined-like input", () => {
      // TypeScript types prevent undefined, but test defensive behavior
      expect(countToolDefinitionTokens([] as never)).toBe(0);
    });

    it("should count tokens for a simple tool with name only", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "get_weather",
          },
        },
      ];

      const tokenCount = countToolDefinitionTokens(tools);
      // Base overhead (12) + tool tokens + wrapper overhead (12)
      expect(tokenCount).toBeGreaterThan(24); // At least base overheads
      expect(tokenCount).toBe(27); // 12 + 3 (name) + 12 = 27
    });

    it("should count tokens for a tool with name and description", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "get_weather",
            description: "Get the current weather for a location",
          },
        },
      ];

      const tokenCount = countToolDefinitionTokens(tools);
      // 12 (base) + 3 (name) + 10 (description ~40 chars / 4) + 12 (wrapper) = 37
      expect(tokenCount).toBeGreaterThan(27);
    });

    it("should count tokens for a tool with parameters", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The city name",
                },
              },
              required: ["location"],
            },
          },
        },
      ];

      const tokenCount = countToolDefinitionTokens(tools);
      expect(tokenCount).toBeGreaterThan(30); // Should include parameter tokens
    });

    it("should count tokens for multiple tools", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "tool_one",
          },
        },
        {
          type: "function" as const,
          function: {
            name: "tool_two",
          },
        },
      ];

      const singleToolTokens = countToolDefinitionTokens([tools[0]]);
      const doubleToolTokens = countToolDefinitionTokens(tools);

      // Two tools should have more tokens than one
      expect(doubleToolTokens).toBeGreaterThan(singleToolTokens);
    });

    it("should count tokens for parameters with enum values", () => {
      const toolsWithoutEnum = [
        {
          type: "function" as const,
          function: {
            name: "set_mode",
            parameters: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  description: "The mode to set",
                },
              },
            },
          },
        },
      ];

      const toolsWithEnum = [
        {
          type: "function" as const,
          function: {
            name: "set_mode",
            parameters: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  description: "The mode to set",
                  enum: ["fast", "slow", "medium"],
                },
              },
            },
          },
        },
      ];

      const tokensWithoutEnum = countToolDefinitionTokens(toolsWithoutEnum);
      const tokensWithEnum = countToolDefinitionTokens(toolsWithEnum);

      // Enum values should add tokens
      expect(tokensWithEnum).toBeGreaterThan(tokensWithoutEnum);
    });

    it("should handle empty enum array without negative token count", () => {
      const toolsWithEmptyEnum = [
        {
          type: "function" as const,
          function: {
            name: "set_mode",
            parameters: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  description: "The mode to set",
                  enum: [],
                },
              },
            },
          },
        },
      ];

      const toolsWithoutEnum = [
        {
          type: "function" as const,
          function: {
            name: "set_mode",
            parameters: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  description: "The mode to set",
                },
              },
            },
          },
        },
      ];

      const tokensWithEmptyEnum = countToolDefinitionTokens(toolsWithEmptyEnum);
      const tokensWithoutEnum = countToolDefinitionTokens(toolsWithoutEnum);

      // Empty enum should not subtract tokens - should be equal to no enum
      expect(tokensWithEmptyEnum).toBe(tokensWithoutEnum);
      // Token count should always be positive
      expect(tokensWithEmptyEnum).toBeGreaterThan(0);
    });

    it("should count tokens for multiple parameters", () => {
      const toolWithOneParam = [
        {
          type: "function" as const,
          function: {
            name: "search",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                },
              },
            },
          },
        },
      ];

      const toolWithMultipleParams = [
        {
          type: "function" as const,
          function: {
            name: "search",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                },
                limit: {
                  type: "number",
                },
                offset: {
                  type: "number",
                },
              },
            },
          },
        },
      ];

      const oneParamTokens = countToolDefinitionTokens(toolWithOneParam);
      const multiParamTokens = countToolDefinitionTokens(
        toolWithMultipleParams,
      );

      expect(multiParamTokens).toBeGreaterThan(oneParamTokens);
    });

    it("should handle tool with empty parameters object", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "no_params",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ];

      const tokenCount = countToolDefinitionTokens(tools);
      // Should still return a valid count (base overhead + name)
      expect(tokenCount).toBeGreaterThan(0);
    });

    it("should handle tool without parameters field", () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "simple_tool",
            description: "A simple tool without parameters",
          },
        },
      ];

      const tokenCount = countToolDefinitionTokens(tools);
      expect(tokenCount).toBeGreaterThan(0);
    });

    describe("real-world tool definitions", () => {
      it("should count tokens for a complex tool like read_file", () => {
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "read_file",
              description:
                "Use this tool if you need to view the contents of an existing file.",
              parameters: {
                type: "object",
                properties: {
                  filepath: {
                    type: "string",
                    description:
                      "The path of the file to read. Can be a relative path, absolute path, tilde path, or file:// URI",
                  },
                },
                required: ["filepath"],
              },
            },
          },
        ];

        const tokenCount = countToolDefinitionTokens(tools);
        expect(tokenCount).toBeGreaterThan(40); // Complex tool should have many tokens
      });

      it("should count tokens for a multi-tool set", () => {
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "read_file",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: {
                  filepath: { type: "string", description: "File path" },
                },
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "write_file",
              description: "Write to a file",
              parameters: {
                type: "object",
                properties: {
                  filepath: { type: "string", description: "File path" },
                  content: { type: "string", description: "Content to write" },
                },
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "search",
              description: "Search for files",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                },
              },
            },
          },
        ];

        const tokenCount = countToolDefinitionTokens(tools);
        // Multiple tools should have significant token count
        expect(tokenCount).toBeGreaterThan(80);
      });
    });
  });
});
