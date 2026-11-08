import crypto from "crypto";

import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionTool } from "openai/resources.mjs";
import { describe, expect, it } from "vitest";

import { isUserBriefContent, withUserBrief } from "../agent/userBrief.js";

import { composeRequestMessages } from "./requestMessages.js";

const USER_TEXT =
  "Fix the loader crash in src/parser.ts. It must fall back to defaults and `npm test` must pass.";
const SYSTEM = "SYSTEM PROMPT";
const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    },
  },
];

function baseHistory(): ChatHistoryItem[] {
  return convertToUnifiedHistory([
    { role: "user", content: "Earlier request about the docs." },
    { role: "assistant", content: "Done." },
    { role: "user", content: USER_TEXT },
  ]);
}

function hash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

describe("the user brief in the request", () => {
  it("lands after the history and immediately before the user message", () => {
    const base = baseHistory();
    const briefed = withUserBrief(base, { enabled: true }).history;
    const messages = composeRequestMessages({
      chatHistory: briefed,
      systemMessage: SYSTEM,
    });

    expect(messages[0]).toEqual({ role: "system", content: SYSTEM });
    expect(messages[1]).toEqual({
      role: "user",
      content: "Earlier request about the docs.",
    });
    expect(messages[2]).toEqual({ role: "assistant", content: "Done." });
    expect(messages[3].role).toBe("user");
    expect(isUserBriefContent(String(messages[3].content ?? ""))).toBe(true);
    expect(messages[4]).toEqual({ role: "user", content: USER_TEXT });
    expect(messages).toHaveLength(base.length + 2);
  });

  it("sends the identical request when the toggle is off", () => {
    const base = baseHistory();
    const without = composeRequestMessages({
      chatHistory: base,
      systemMessage: SYSTEM,
    });
    const off = withUserBrief(base, { enabled: false }).history;
    const after = composeRequestMessages({
      chatHistory: off,
      systemMessage: SYSTEM,
    });

    expect(after).toEqual(without);
  });

  it("keeps the system and tool hashes unchanged", () => {
    const base = baseHistory();
    const before = composeRequestMessages({
      chatHistory: base,
      systemMessage: SYSTEM,
    });
    const briefed = withUserBrief(base, { enabled: true }).history;
    const after = composeRequestMessages({
      chatHistory: briefed,
      systemMessage: SYSTEM,
    });

    // The brief is history, never a system field or a tool definition.
    expect(hash({ system: before[0], tools: TOOLS })).toBe(
      hash({ system: after[0], tools: TOOLS }),
    );
    // The cached prefix through the user's message is unchanged except for the
    // inserted user-role message.
    expect(after.filter((message) => message.role === "system")).toEqual([
      before[0],
    ]);
  });

  it("does not move on a later round", () => {
    const base = baseHistory();
    const briefed = withUserBrief(base, { enabled: true }).history;
    const roundOne = composeRequestMessages({
      chatHistory: briefed,
      systemMessage: SYSTEM,
    });

    // The next round appends the assistant answer and its tool result. The
    // brief stays at its original offset, so the first request's bytes remain
    // a prefix of this one.
    const roundTwoHistory = [
      ...briefed,
      ...convertToUnifiedHistory([{ role: "assistant", content: "working" }]),
    ];
    const roundTwo = composeRequestMessages({
      chatHistory: roundTwoHistory,
      systemMessage: SYSTEM,
    });

    expect(roundTwo.slice(0, roundOne.length)).toEqual(roundOne);
  });
});
