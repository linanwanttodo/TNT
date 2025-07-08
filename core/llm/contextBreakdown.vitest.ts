import { describe, expect, it } from "vitest";

import type { ChatMessage, Tool } from "../index.js";
import { BuiltInToolNames } from "../tools/builtIn.js";
import { TOOL_RESULT_TRUNCATION_MARKER } from "../util/toolResultCompaction.js";
import { compileChatMessages } from "./countTokens.js";

function makeTool(name: string, description: string, uri?: string): Tool {
  return {
    type: "function",
    displayTitle: name,
    readonly: true,
    group: "test",
    uri,
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
      },
    },
  };
}

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "How are models resolved?" },
  { role: "assistant", content: "They live in selectedModelByRole." },
];

describe("compileChatMessages token breakdown", () => {
  it("splits the input tokens into the reported categories", () => {
    const tools = [
      makeTool(BuiltInToolNames.ReadFile, "Read a file from disk"),
      makeTool("mcp_search", "Search the MCP server", "mcp://docs/search"),
      makeTool(BuiltInToolNames.ReadSkill, "Read a skill by name"),
    ];

    const result = compileChatMessages({
      modelName: "gpt-4",
      msgs: MESSAGES,
      knownContextLength: 128_000,
      maxTokens: 4096,
      supportsImages: false,
      tools,
    });

    const breakdown = result.tokenBreakdown!;
    expect(breakdown).toBeDefined();
    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.tools).toBeGreaterThan(0);
    expect(breakdown.mcp).toBeGreaterThan(0);
    expect(breakdown.skills).toBeGreaterThan(0);
    expect(breakdown.conversation).toBeGreaterThan(0);

    expect(breakdown.used).toBe(
      breakdown.systemPrompt +
        breakdown.tools +
        breakdown.mcp +
        breakdown.skills +
        breakdown.conversation,
    );
    expect(breakdown.available).toBeGreaterThan(0);
    expect(breakdown.contextLength).toBe(128_000);
    expect(result.contextPercentage).toBeCloseTo(
      breakdown.used / breakdown.available,
    );
  });

  it("reports an empty tool bucket when no tools are active", () => {
    const result = compileChatMessages({
      modelName: "gpt-4",
      msgs: MESSAGES,
      knownContextLength: 128_000,
      maxTokens: 4096,
      supportsImages: false,
    });

    const breakdown = result.tokenBreakdown!;
    expect(breakdown.tools).toBe(0);
    expect(breakdown.mcp).toBe(0);
    expect(breakdown.skills).toBe(0);
    expect(breakdown.used).toBe(
      breakdown.systemPrompt + breakdown.conversation,
    );
  });

  it("records bounded tool-result compaction as context pruning", () => {
    const longOutput = `${"0123456789abcdef".repeat(1280)}`;
    const toolMessages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => {
      const id = `call-${i}`;
      return [
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [
            {
              id,
              type: "function" as const,
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool" as const,
          content: i === 0 ? longOutput : `recent output ${i}`,
          toolCallId: id,
        },
      ];
    }).flat();
    const result = compileChatMessages({
      modelName: "gpt-4",
      msgs: [
        { role: "user", content: "Start" },
        ...toolMessages,
        { role: "user", content: "Continue" },
        { role: "assistant", content: "Done" },
      ],
      knownContextLength: 5000,
      maxTokens: 512,
      supportsImages: false,
    });

    expect(result.didPrune).toBe(true);
    expect(
      result.compiledChatMessages.some(
        (message) =>
          message.role === "tool" &&
          message.content.includes(TOOL_RESULT_TRUNCATION_MARKER),
      ),
    ).toBe(true);
  });
});
