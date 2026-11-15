import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isUserBriefContent } from "../agent/userBrief.js";
import {
  resetUserBriefOverride,
  setUserBriefEnabled,
} from "../agent/userBriefSettings.js";

const USER_TEXT =
  "Fix the loader crash in src/parser.ts. It must fall back to defaults and `npm test` must pass.";

const captured: Array<{
  chatHistory: ChatHistoryItem[];
  systemMessage: string;
}> = [];

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: { getSystemMessage: vi.fn(async () => "SYSTEM") },
    toolPermissions: {
      getState: () => ({ currentMode: "default" }),
      isHeadless: () => true,
    },
    chatHistory: {
      isReady: () => false,
      getHistory: vi.fn(() => []),
      setHistory: vi.fn(),
    },
  },
}));

vi.mock("./processStreamingResponse.js", () => ({
  processStreamingResponse: vi.fn(
    async (options: {
      chatHistory: ChatHistoryItem[];
      systemMessage: string;
    }) => {
      captured.push({
        chatHistory: options.chatHistory,
        systemMessage: options.systemMessage,
      });
      return {
        content: "done",
        finalContent: "done",
        toolCalls: [],
        shouldContinue: false,
      };
    },
  ),
}));

vi.mock("./handleToolCalls.js", () => ({
  getRequestTools: vi.fn(async () => []),
  handleToolCalls: vi.fn(async () => false),
}));

vi.mock("./requestPreparation.js", () => ({
  prepareRoundRequest: vi.fn(
    async (options: { chatHistory: ChatHistoryItem[] }) => ({
      chatHistory: options.chatHistory,
      compacted: false,
      previousHeader: undefined,
      verdict: undefined,
    }),
  ),
}));

vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePostToolValidation: vi.fn(
    async (_toolCalls: unknown, history: ChatHistoryItem[]) => ({
      chatHistory: history,
      wasCompacted: false,
    }),
  ),
  handleNormalAutoCompaction: vi.fn(async (history: ChatHistoryItem[]) => ({
    chatHistory: history,
    wasCompacted: false,
  })),
}));

import { streamChatResponse } from "./streamChatResponse.js";

const model = {
  provider: "openai",
  name: "test-model",
  model: "test-model",
  defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
} as any;

function history(): ChatHistoryItem[] {
  return convertToUnifiedHistory([
    { role: "user", content: "Earlier request about the docs." },
    { role: "assistant", content: "Done." },
    { role: "user", content: USER_TEXT },
  ]);
}

async function run(): Promise<{
  chatHistory: ChatHistoryItem[];
  systemMessage: string;
}> {
  captured.length = 0;
  await streamChatResponse(
    history(),
    model,
    {} as any,
    new AbortController(),
    undefined,
    false,
  );
  expect(captured).toHaveLength(1);
  return captured[0];
}

describe("the brief in the turn path", () => {
  beforeEach(() => {
    resetUserBriefOverride();
    setUserBriefEnabled(true);
  });

  afterEach(() => {
    resetUserBriefOverride();
  });

  it("sends the brief immediately before the user message", async () => {
    const sent = await run();
    const last = sent.chatHistory.at(-1);
    const before = sent.chatHistory.at(-2);

    expect(last?.message.role).toBe("user");
    expect(String(last?.message.content)).toBe(USER_TEXT);
    expect(String(before?.message.content)).toContain("<user-brief>");
    expect(isUserBriefContent(String(before?.message.content))).toBe(true);
    // The system field and the tool list are not part of this decision.
    expect(sent.systemMessage).toBe("SYSTEM");
  });

  it("sends the history unchanged when the toggle is off", async () => {
    setUserBriefEnabled(false);
    const sent = await run();

    expect(sent.chatHistory).toHaveLength(3);
    expect(
      sent.chatHistory.some((item) =>
        isUserBriefContent(String(item.message.content ?? "")),
      ),
    ).toBe(false);
    expect(String(sent.chatHistory.at(-1)?.message.content)).toBe(USER_TEXT);
  });
});
