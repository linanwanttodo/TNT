import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { describe, expect, it } from "vitest";

import {
  composeRequestMessages,
  formatInHistoryUpdate,
} from "./requestMessages.js";

function historyOf(
  ...messages: Array<{ role: "user" | "assistant"; content: string }>
): ChatHistoryItem[] {
  return convertToUnifiedHistory(messages);
}

describe("composeRequestMessages", () => {
  it("keeps an update at the position it was produced as the history grows", () => {
    const firstRoundHistory = historyOf(
      { role: "user", content: "do it" },
      { role: "assistant", content: "working" },
    );
    const update = { text: "rule v2", at: firstRoundHistory.length };

    const roundOne = composeRequestMessages({
      chatHistory: firstRoundHistory,
      systemMessage: "SYS",
      updates: [update],
    });

    // The next round appends the tool result and the next answer. The update
    // used to be re-appended after all of that, which moved its bytes and made
    // the provider rebill from the old position.
    const roundTwo = composeRequestMessages({
      chatHistory: historyOf(
        { role: "user", content: "do it" },
        { role: "assistant", content: "working" },
        { role: "user", content: "tool result" },
        { role: "assistant", content: "next answer" },
      ),
      systemMessage: "SYS",
      updates: [update],
    });

    expect(roundTwo.slice(0, roundOne.length)).toEqual(roundOne);
    expect(roundOne.at(-1)).toEqual({
      role: "user",
      content: formatInHistoryUpdate("rule v2"),
    });
  });

  it("does not put a second system message in the history", () => {
    const messages = composeRequestMessages({
      chatHistory: historyOf({ role: "user", content: "hi" }),
      systemMessage: "SYS",
      updates: [{ text: "changed rule", at: 1 }],
    });

    expect(messages.filter((message) => message.role === "system")).toEqual([
      { role: "system", content: "SYS" },
    ]);
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: formatInHistoryUpdate("changed rule"),
    });
  });

  it("delivers the environment in the first user message", () => {
    const messages = composeRequestMessages({
      chatHistory: historyOf(
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ),
      systemMessage: "SYS",
      environmentContext: "ENV-SNAPSHOT",
    });

    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[1]).toEqual({
      role: "user",
      content: "ENV-SNAPSHOT\n\nhi",
    });
    expect(messages[2]).toEqual({ role: "assistant", content: "hello" });
  });

  it("invents a user message for the environment when history is empty", () => {
    const messages = composeRequestMessages({
      chatHistory: [],
      systemMessage: "SYS",
      updates: [{ text: "a rule", at: 0 }],
      environmentContext: "ENV-SNAPSHOT",
    });

    expect(messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "ENV-SNAPSHOT" },
      { role: "user", content: formatInHistoryUpdate("a rule") },
    ]);
  });

  it("carries the environment inside structured content", () => {
    const messages = composeRequestMessages({
      chatHistory: convertToUnifiedHistory([
        {
          role: "user",
          content: [{ type: "text", text: "with an image" }],
        },
      ]),
      systemMessage: "SYS",
      environmentContext: "ENV-SNAPSHOT",
    });

    expect(messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "ENV-SNAPSHOT" },
        { type: "text", text: "with an image" },
      ],
    });
  });
});
