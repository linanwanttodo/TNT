import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { projectMessage, toolStateSignature } from "./transcript.js";

function item(partial: Partial<ChatHistoryItem>): ChatHistoryItem {
  return {
    message: { role: "user", content: "" },
    contextItems: [],
    ...partial,
  } as ChatHistoryItem;
}

describe("projectMessage", () => {
  it("projects a user message as text with a bullet", () => {
    const row = projectMessage(
      item({ message: { role: "user", content: "hello" } }),
      0,
    );

    expect(row).toEqual({
      kind: "message",
      key: "user-0",
      role: "user",
      content: "hello",
      reasoning: undefined,
      toolStates: undefined,
      streaming: false,
      hideBullet: false,
    });
  });

  it("splits a legacy think block out of assistant text", () => {
    const row = projectMessage(
      item({
        message: {
          role: "assistant",
          content: "<think>looking</think>the answer",
        },
      }),
      1,
    );

    expect(row).toMatchObject({
      kind: "message",
      role: "assistant",
      reasoning: "looking",
      content: "the answer",
    });
  });

  it("prefers a typed reasoning value over a think block", () => {
    const row = projectMessage(
      item({
        message: {
          role: "assistant",
          content: "<think>from text</think>the answer",
        },
        reasoning: { active: false, text: "typed", startAt: 0, endAt: 1 },
      }),
      2,
    );

    expect(row).toMatchObject({ reasoning: "typed", content: "the answer" });
  });

  it("projects a thinking message as reasoning without an answer", () => {
    const row = projectMessage(
      item({ message: { role: "thinking", content: "considering" } }),
      3,
    );

    expect(row).toMatchObject({
      kind: "message",
      role: "assistant",
      reasoning: "considering",
      content: "",
    });
  });

  it("keeps tool states on the same row as the answer", () => {
    const toolStates = [
      {
        toolCallId: "call-1",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "Read", arguments: "{}" },
        },
        status: "done",
        parsedArgs: {},
        output: [{ name: "result", content: "body", description: "" }],
      },
    ] as ChatHistoryItem["toolCallStates"];

    const row = projectMessage(
      item({
        message: { role: "assistant", content: "done" },
        toolCallStates: toolStates,
      }),
      4,
    );

    expect(row).toMatchObject({ content: "done", toolStates });
  });

  it("projects a compaction summary as its own row", () => {
    const row = projectMessage(
      item({ conversationSummary: "earlier work" }),
      5,
    );

    expect(row).toEqual({
      kind: "compaction",
      key: "compaction-5",
      summary: "earlier work",
    });
  });

  it("drops an empty system message but keeps a populated one", () => {
    expect(
      projectMessage(item({ message: { role: "system", content: "" } }), 6),
    ).toBeNull();
    expect(
      projectMessage(
        item({ message: { role: "system", content: "rules" } }),
        7,
      ),
    ).toMatchObject({ kind: "system", content: "rules" });
  });
});

describe("toolStateSignature", () => {
  it("counts output rather than serializing it", () => {
    const states = [
      {
        toolCallId: "call-1",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "Read", arguments: "{}" },
        },
        status: "done",
        parsedArgs: {},
        output: [{ name: "result", content: "12345", description: "" }],
      },
    ] as ChatHistoryItem["toolCallStates"];

    expect(toolStateSignature(states)).toContain(":5;");
  });
});
