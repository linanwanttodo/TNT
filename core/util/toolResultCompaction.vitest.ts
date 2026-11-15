import { describe, expect, it } from "vitest";

import type { ChatHistoryItem, ChatMessage } from "../index.js";
import {
  TOOL_RESULT_TRUNCATION_MARKER,
  compactToolCallOutputs,
  compactToolResults,
} from "./toolResultCompaction.js";

function toolResult(id: string, body: string): ChatMessage {
  return { role: "tool", content: body, toolCallId: id };
}

describe("compactToolResults", () => {
  it("retains head and tail excerpts for oversized older results", () => {
    const head = "h".repeat(4096);
    const tail = "t".repeat(1024);
    const messages: ChatMessage[] = [
      { role: "user", content: "start" },
      toolResult("old", `${head}${"m".repeat(2048)}${tail}`),
      toolResult("recent-1", "recent result 1"),
      toolResult("recent-2", "recent result 2"),
      toolResult("recent-3", "recent result 3"),
      toolResult("recent-4", "recent result 4"),
      toolResult("recent-5", "recent result 5"),
    ];

    const { messages: out, truncatedCount } = compactToolResults(messages);

    expect(truncatedCount).toBe(1);
    expect(out[1].content).toBe(
      `${head}${TOOL_RESULT_TRUNCATION_MARKER}${tail}`,
    );
    expect(out.slice(2).map((message) => message.content)).toEqual([
      "recent result 1",
      "recent result 2",
      "recent result 3",
      "recent result 4",
      "recent result 5",
    ]);
  });

  it("preserves the tool call id and role so the structure stays valid", () => {
    const { messages: out } = compactToolResults(
      [toolResult("call-1", "body")],
      0,
    );

    expect(out[0].role).toBe("tool");
    expect((out[0] as { toolCallId?: string }).toolCallId).toBe("call-1");
  });

  it("is idempotent for previously truncated results", () => {
    const body = `${"h".repeat(4096)}${"m".repeat(2048)}${"t".repeat(1024)}`;
    const once = compactToolResults([toolResult("a", "body")], 0);
    const truncated = compactToolResults([toolResult("a", body)], 0);
    const twice = compactToolResults(truncated.messages, 0);

    expect(once.truncatedCount).toBe(0);
    expect(twice.truncatedCount).toBe(0);
    expect(twice.messages[0].content).toBe(truncated.messages[0].content);
  });

  it("leaves non-tool messages untouched", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const { messages: out, truncatedCount } = compactToolResults(messages, 0);

    expect(truncatedCount).toBe(0);
    expect(out).toEqual(messages);
  });

  it("does not split surrogate pairs at excerpt boundaries", () => {
    const emoji = "\u{1F600}";
    const body = `${"a".repeat(4095)}${emoji}${"b".repeat(3000)}${"c".repeat(1018)}${emoji}${"d".repeat(5)}`;

    const { messages: out } = compactToolResults([toolResult("a", body)], 0);
    const content = out[0].content as string;
    const loneSurrogates = Array.from(content).filter((codePoint) => {
      const value = codePoint.charCodeAt(0);
      return codePoint.length === 1 && value >= 0xd800 && value <= 0xdfff;
    });

    expect(content).toContain(emoji);
    expect(loneSurrogates).toEqual([]);
  });

  it("preserves large skill URI results", () => {
    const message = toolResult(
      "skill-read",
      `skill://${"content".repeat(1000)}`,
    );

    const { messages: out, truncatedCount } = compactToolResults([message], 0);

    expect(truncatedCount).toBe(0);
    expect(out[0].content).toBe(message.content);
  });

  it("preserves results from the skill-reading tool in CLI history", () => {
    const body = "0123456789abcdef".repeat(400);
    const history: ChatHistoryItem[] = [
      {
        message: { role: "assistant", content: "" },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: "skill-read",
            toolCall: {
              id: "skill-read",
              type: "function",
              function: { name: "read_skill", arguments: "{}" },
            },
            status: "done",
            parsedArgs: {},
            output: [
              {
                content: body,
                name: "Tool Result: read_skill",
                description: "Tool execution result",
              },
            ],
          },
        ],
      },
    ];

    const { history: out, truncatedCount } = compactToolCallOutputs(history, 0);

    expect(truncatedCount).toBe(0);
    expect(out[0].toolCallStates?.[0].output?.[0].content).toBe(body);
  });

  it("preserves results from artifact recovery tools", () => {
    const body = `${"0123456789abcdef".repeat(400)}`;
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "artifact-read",
            type: "function",
            function: { name: "restore_artifact", arguments: "{}" },
          },
        ],
      },
      toolResult("artifact-read", body),
    ];

    const { messages: out, truncatedCount } = compactToolResults(messages, 0);

    expect(truncatedCount).toBe(0);
    expect(out[1].content).toBe(body);
  });

  it("does not mutate the input array", () => {
    const messages: ChatMessage[] = [toolResult("a", "original body")];

    compactToolResults(messages, 0);

    expect(messages[0].content).toBe("original body");
  });
});
