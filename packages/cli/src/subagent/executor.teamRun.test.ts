import { beforeEach, describe, expect, it, vi } from "vitest";

const runAgentTurn = vi.fn();
vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn().mockResolvedValue(undefined),
  fireSubagentStop: vi.fn().mockResolvedValue(undefined),
}));

const getCurrentTeamRunMember = vi.hoisted(() => vi.fn());
const startTeamMemberRun = vi.hoisted(() => vi.fn());
const finishTeamMemberRun = vi.hoisted(() => vi.fn());
const saveSubagentSession = vi.hoisted(() =>
  vi.fn(() => ({ sessionId: "member-session" })),
);
const updateSubagentSession = vi.hoisted(() =>
  vi.fn((options: { sessionId: string }) => ({
    sessionId: options.sessionId,
  })),
);

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({
    sessionId: "root",
    history: [],
    delegationDepth: 0,
  })),
  getSessionActiveTeam: vi.fn(() => undefined),
  saveSubagentSession,
  updateSubagentSession,
  getCurrentTeamRunMember,
  startTeamMemberRun,
  finishTeamMemberRun,
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

import { executeSubAgent } from "./executor.js";

const state = (name: string) =>
  ({
    model: { name },
    llmApi: {},
    assistant: {},
  }) as any;

type DepthCall = { agent: string; canDelegate: boolean };

beforeEach(() => {
  runAgentTurn.mockReset();
  getCurrentTeamRunMember.mockReset();
  startTeamMemberRun.mockReset();
  finishTeamMemberRun.mockReset();
  saveSubagentSession.mockClear();
  updateSubagentSession.mockClear();
});

describe("a summoned lead dispatching a member", () => {
  it("runs the member at depth 2 and withholds delegation from it", async () => {
    const depthCalls: DepthCall[] = [];
    const thirdLevel: Array<{ success: boolean; error?: string }> = [];

    getCurrentTeamRunMember.mockImplementation((name: string) =>
      name === "implementer" ? { runId: "run-1" } : undefined,
    );

    runAgentTurn.mockImplementation(async ({ model, runOverrides }: any) => {
      depthCalls.push({
        agent: model.name,
        canDelegate: runOverrides.canDelegate,
      });

      if (model.name === "lead") {
        await executeSubAgent({
          agent: state("implementer"),
          prompt: "do the work",
          parentSessionId: "root",
          abortController: new AbortController(),
        });
      } else if (model.name === "implementer") {
        // A member at depth 2 may try to delegate; the depth limit refuses it
        // before the turn starts.
        thirdLevel.push(
          await executeSubAgent({
            agent: state("helper"),
            prompt: "go deeper",
            parentSessionId: "root",
            abortController: new AbortController(),
          }),
        );
      }
    });

    const result = await executeSubAgent({
      agent: state("lead"),
      prompt: "lead the team",
      parentSessionId: "root",
      abortController: new AbortController(),
      maxDelegationDepth: 2,
    });

    expect(result.success).toBe(true);
    expect(depthCalls).toEqual([
      { agent: "lead", canDelegate: true },
      { agent: "implementer", canDelegate: false },
    ]);
    expect(thirdLevel[0].success).toBe(false);
    expect(thirdLevel[0].error).toContain("Cannot delegate any deeper");

    expect(startTeamMemberRun).toHaveBeenCalledWith(
      "run-1",
      "implementer",
      "implementer",
    );
    expect(finishTeamMemberRun).toHaveBeenCalledWith(
      "run-1",
      "implementer",
      expect.objectContaining({
        success: true,
        subagentSessionId: "member-session",
      }),
    );
  });

  it("does not attribute the lead's own run to the member ledger", async () => {
    getCurrentTeamRunMember.mockImplementation(() => undefined);
    runAgentTurn.mockResolvedValue("lead report");

    await executeSubAgent({
      agent: state("lead"),
      prompt: "lead the team",
      parentSessionId: "root",
      abortController: new AbortController(),
      maxDelegationDepth: 2,
    });

    expect(startTeamMemberRun).not.toHaveBeenCalled();
    expect(finishTeamMemberRun).not.toHaveBeenCalled();
  });
});

describe("the member wall-clock timeout", () => {
  it("returns a failed member instead of hanging", async () => {
    getCurrentTeamRunMember.mockImplementation((name: string) =>
      name === "implementer" ? { runId: "run-1" } : undefined,
    );
    // A provider that never settles.
    runAgentTurn.mockImplementation(() => new Promise(() => {}));

    const result = await executeSubAgent({
      agent: state("implementer"),
      prompt: "do the work",
      parentSessionId: "root",
      abortController: new AbortController(),
      memberTimeoutMs: 20,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(finishTeamMemberRun).toHaveBeenCalledWith(
      "run-1",
      "implementer",
      expect.objectContaining({ success: false }),
    );
  });

  it("marks the member cancelled when the parent controller aborts", async () => {
    getCurrentTeamRunMember.mockImplementation((name: string) =>
      name === "implementer" ? { runId: "run-1" } : undefined,
    );
    const controller = new AbortController();
    runAgentTurn.mockImplementation(async () => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const result = await executeSubAgent({
      agent: state("implementer"),
      prompt: "do the work",
      parentSessionId: "root",
      abortController: controller,
    });

    expect(result.success).toBe(false);
    expect(finishTeamMemberRun).toHaveBeenCalledWith(
      "run-1",
      "implementer",
      expect.objectContaining({
        success: false,
        cancelled: true,
        subagentSessionId: "member-session",
      }),
    );
  });
});
