import type { ChatHistoryItem } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelServiceState } from "../services/types.js";

import { streamChatResponse } from "../stream/streamChatResponse.js";

import { executeSubAgent } from "./executor.js";
import type { AgentRunContext } from "./runContext.js";

vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(),
}));

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn(async () => ({ blocked: false, results: [] })),
  fireSubagentStop: vi.fn(async () => ({ blocked: false, results: [] })),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "parent", history: [] })),
  saveSubagentSession: vi.fn(),
}));

vi.mock("../utils/cli.js", () => ({
  escapeEvents: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: { getSystemMessage: vi.fn(async () => "base prompt") },
    toolPermissions: {
      getState: vi.fn(() => ({
        currentMode: "agent",
        permissions: { policies: [{ tool: "*", permission: "allow" }] },
      })),
    },
  },
}));

const parent: AgentRunContext = {
  id: "parent",
  parentContext: undefined,
  delegationDepth: 0,
  systemMessage: "base prompt",
  permissions: { policies: [{ tool: "*", permission: "allow" }] },
  mode: "agent",
  abortSignal: new AbortController().signal,
};

/**
 * The verdict is read where the report is assembled, so every caller of the
 * executor - the delegation tool and the `agent` hook alike - gets it without
 * re-reading prose.
 */
describe("executeSubAgent verdict", () => {
  const agent = {
    model: {
      name: "verification",
      chatOptions: { baseSystemMessage: "check the work" },
    },
    llmApi: {},
  } as unknown as ModelServiceState;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function childAnswers(content: string) {
    vi.mocked(streamChatResponse).mockImplementation(
      async (chatHistory: ChatHistoryItem[]) => {
        chatHistory.push({
          message: { role: "assistant", content },
          contextItems: [],
        });
        return content;
      },
    );
  }

  it("reports the verdict the child ended with", async () => {
    childAnswers("tests fail on the boundary input\nVERDICT: FAIL");

    const result = await executeSubAgent({
      agent,
      prompt: "verify the parser change",
      parentSessionId: "parent",
      parentContext: parent,
      abortController: new AbortController(),
    });

    expect(result.success).toBe(true);
    expect(result.verdict).toBe("fail");
  });

  it("leaves the verdict unset when the child wrote no verdict line", async () => {
    childAnswers("the change looks fine to me");

    const result = await executeSubAgent({
      agent,
      prompt: "verify the parser change",
      parentSessionId: "parent",
      parentContext: parent,
      abortController: new AbortController(),
    });

    expect(result.verdict).toBeUndefined();
  });
});
