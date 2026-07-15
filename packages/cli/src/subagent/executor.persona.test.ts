import { describe, expect, it, vi } from "vitest";

vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(async (chatHistory: any[]) => {
    chatHistory.push({
      message: { role: "assistant", content: "done" },
      contextItems: [],
    });
    return "done";
  }),
}));

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn(async () => ({ blocked: false, results: [] })),
  fireSubagentStop: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const activeTeam = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));
vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "parent", history: [] })),
  saveSubagentSession: vi.fn(() => ({ sessionId: "child-session" })),
  updateSubagentSession: vi.fn((options: { sessionId: string }) => ({
    sessionId: options.sessionId,
  })),
  getSessionActiveTeam: vi.fn(() => activeTeam.value),
  getCurrentTeamRunMember: vi.fn(() => undefined),
  startTeamMemberRun: vi.fn(),
  finishTeamMemberRun: vi.fn(),
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
        currentMode: "default",
        permissions: { policies: [{ tool: "*", permission: "allow" }] },
      })),
    },
  },
}));

import type { ModelServiceState } from "../services/types.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";

import { executeSubAgent } from "./executor.js";

type ChildRun = { systemMessage: string };

/**
 * Dispatching a team member hands the executor a session-model state named
 * after the member; the child run's system message must carry the member's
 * persona, not the raw session model's (which has no baseSystemMessage and
 * would leave the child without its role).
 */
async function runAs(
  agentName: string,
  modelState: ModelServiceState,
): Promise<ChildRun> {
  await executeSubAgent({
    agent: modelState,
    prompt: "do the work",
    parentSessionId: "parent",
    abortController: new AbortController(),
  });

  const lastCall = vi.mocked(streamChatResponse).mock.calls.at(-1)?.[7];
  if (!lastCall) {
    throw new Error("the delegated run never reached the engine");
  }
  return lastCall as unknown as ChildRun;
}

function sessionModelState(name: string): ModelServiceState {
  return {
    model: { name, provider: "openai", model: "gpt-x", roles: ["chat"] },
    llmApi: {},
    assistant: null,
  } as unknown as ModelServiceState;
}

function teamMemberState(): ModelServiceState {
  const state = sessionModelState("implementer");
  (state.model as any).chatOptions = undefined;
  return state;
}

describe("team member dispatch carries the persona prompt", () => {
  it("runs a team member on its roster prompt, not an empty one", async () => {
    activeTeam.value = "dev";

    try {
      const overrides = await runAs("implementer", teamMemberState());

      expect(overrides.systemMessage).toContain("base prompt");
      expect(overrides.systemMessage).toContain("先写失败的测试");
    } finally {
      activeTeam.value = undefined;
    }
  });

  it("still uses a configured agent's own baseSystemMessage", async () => {
    const state = sessionModelState("code-explorer");
    (state.model as any).chatOptions = {
      baseSystemMessage: "configured persona",
    };

    const overrides = await runAs("code-explorer", state);

    expect(overrides.systemMessage).toContain("configured persona");
    expect(overrides.systemMessage).not.toContain("先写失败的测试");
  });
});

export { runAs, sessionModelState };
export type { ChildRun };
