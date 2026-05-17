import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { buildContextBreakdown } from "./contextBreakdown.js";

describe("buildContextBreakdown", () => {
  const model: ModelConfig = {
    name: "test-model",
    provider: "deepseek",
    model: "deepseek-chat",
    contextLength: 100_000,
  };

  it("calculates breakdown for empty session with a default context limit", () => {
    const result = buildContextBreakdown([], model, []);
    expect(result.contextLimit).toBe(100_000);
    expect(result.usedTokens).toBe(0);
    expect(result.freeTokens).toBe(100_000);
    expect(result.percentUsed).toBe(0);
    expect(result.categories.systemPrompt).toBe(0);
    expect(result.categories.tools).toBe(0);
    expect(result.categories.conversation).toBe(0);
    expect(result.categories.toolResults).toBe(0);
    expect(result.categories.contextItems).toBe(0);
  });

  it("separates system prompt, conversation, tool results, and context items", () => {
    const history: ChatHistoryItem[] = [
      {
        message: {
          role: "system",
          content: "You are an assistant with specialized knowledge.",
        },
        contextItems: [],
      },
      {
        message: {
          role: "user",
          content: "Read the file packages/cli/package.json",
        },
        contextItems: [
          {
            id: { providerTitle: "file", itemId: "package.json" },
            name: "package.json",
            description: "Root package",
            content: '{"name": "test"}',
          },
        ],
      },
      {
        message: {
          role: "assistant",
          content: "Let me check that for you.",
        },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: "call_1",
            status: "done",
            parsedArgs: { path: "packages/cli/package.json" },
            toolCall: {
              id: "call_1",
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: '{"path":"packages/cli/package.json"}',
              },
            },
            output: [
              {
                name: "package.json",
                description: "Root package",
                content: '{"name":"@tnt/cli","version":"1.0.9"}',
              },
            ],
          },
        ],
      },
    ];

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "read_file",
          description: "Reads a file from disk",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Absolute path" },
            },
            required: ["path"],
          },
        },
      },
    ];

    const result = buildContextBreakdown(history, model, tools);

    expect(result.categories.systemPrompt).toBeGreaterThan(0);
    expect(result.categories.tools).toBeGreaterThan(0);
    expect(result.categories.conversation).toBeGreaterThan(0);
    expect(result.categories.toolResults).toBeGreaterThan(0);
    expect(result.categories.contextItems).toBeGreaterThan(0);

    const sum =
      result.categories.systemPrompt +
      result.categories.tools +
      result.categories.conversation +
      result.categories.toolResults +
      result.categories.contextItems;

    expect(result.usedTokens).toBe(sum);
    expect(result.freeTokens).toBe(100_000 - sum);
    expect(result.percentUsed).toBe(Math.round((sum / 100_000) * 100));
  });

  it("handles model without explicit contextLength by falling back to DEFAULT_CONTEXT_LENGTH", () => {
    const plainModel: ModelConfig = {
      name: "plain",
      provider: "openai",
      model: "gpt-4",
    };
    const result = buildContextBreakdown([], plainModel);
    expect(result.contextLimit).toBe(200_000);
    expect(result.freeTokens).toBe(200_000);
  });
});
