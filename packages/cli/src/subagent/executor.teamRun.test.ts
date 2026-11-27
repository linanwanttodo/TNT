import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import { workspaceRoot as currentWorkspaceRoot } from "../utils/workspaceScope.js";

const runAgentTurn = vi.fn();
const teammateIdle = vi.hoisted(() => vi.fn());
const createWorktree = vi.hoisted(() =>
  vi.fn(async () => "/tmp/subagent-worktree"),
);
const cleanupWorktree = vi.hoisted(() =>
  vi.fn(async (_worktree: string) => undefined),
);
vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn().mockResolvedValue(undefined),
  fireSubagentStop: vi.fn().mockResolvedValue(undefined),
  fireTeammateIdle: (...args: unknown[]) => teammateIdle(...args),
}));

const getCurrentTeamRunMember = vi.hoisted(() => vi.fn());
const startTeamMemberRun = vi.hoisted(() => vi.fn());
const finishTeamMemberRun = vi.hoisted(() => vi.fn());
const saveSubagentSession = vi.hoisted(() =>
  vi.fn(() => ({ sessionId: "member-session" })),
);
const updateSubagentSession = vi.hoisted(() =>
  vi.fn((options: { sessionId: string }, _history?: unknown) => ({
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
vi.mock("./worktree.js", () => ({
  createSubagentWorktree: () => createWorktree(),
  cleanupSubagentWorktree: (worktree: string) => cleanupWorktree(worktree),
}));
vi.mock("../utils/loadMarkdownSkills.js", () => ({
  loadMarkdownSkills: vi.fn(async () => ({
    skills: [
      {
        name: "alpha",
        description: "Alpha procedure",
        content: "Always run the alpha checks.",
        path: ".tnt/skills/alpha/SKILL.md",
        files: [],
        enabled: true,
      },
    ],
    errors: [],
  })),
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: { getSystemMessage: vi.fn(async () => "base prompt") },
    toolPermissions: {
      getState: vi.fn(() => ({
        currentMode: "default",
        permissions: { policies: [{ tool: "*", permission: "allow" }] },
      })),
      isHeadless: vi.fn(() => false),
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

type DepthCall = {
  agent: string;
  canDelegate: boolean;
  agentType?: string;
  sessionId?: string;
};

beforeEach(() => {
  runAgentTurn.mockReset();
  teammateIdle.mockReset();
  teammateIdle.mockResolvedValue({ blocked: false, results: [] });
  createWorktree.mockClear();
  cleanupWorktree.mockClear();
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
        agentType: runOverrides.agentType,
        sessionId: runOverrides.sessionId,
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
    // Each dispatch names itself and its child session in the run overrides,
    // which is what keys the per-agent usage rows.
    expect(depthCalls).toEqual([
      {
        agent: "lead",
        canDelegate: true,
        agentType: "lead",
        sessionId: "member-session",
      },
      {
        agent: "implementer",
        canDelegate: false,
        agentType: "implementer",
        sessionId: "member-session",
      },
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

describe("markdown agent runtime configuration", () => {
  it("applies maxTurns, permissionMode, tools and preloaded skills", async () => {
    runAgentTurn.mockResolvedValue("done");

    await executeSubAgent({
      agent: state("configured"),
      prompt: "do the work",
      parentSessionId: "root",
      abortController: new AbortController(),
      maxTurns: 2,
      permissionMode: "plan",
      allowedTools: ["Read"],
      skills: ["alpha"],
    });

    const options = runAgentTurn.mock.calls[0][0];
    expect(options.turnBudgetLimits).toEqual({ maxSteps: 2 });
    expect(options.runOverrides.systemMessage).toContain(
      "Always run the alpha checks.",
    );
    expect(
      checkToolPermission(
        { name: "Write", arguments: {} },
        options.runOverrides.permissions,
      ).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(
        { name: "Read", arguments: {} },
        options.runOverrides.permissions,
      ).permission,
    ).toBe("allow");
    expect(options.runOverrides.permissions.policies).toContainEqual({
      tool: "*",
      permission: "exclude",
    });
  });
});

describe("worktree isolation", () => {
  it("runs the child in its worktree and cleans it up", async () => {
    runAgentTurn.mockImplementation(async () => {
      expect(currentWorkspaceRoot()).toBe("/tmp/subagent-worktree");
      return "done";
    });

    await executeSubAgent({
      agent: state("isolated"),
      prompt: "do the work",
      parentSessionId: "root",
      abortController: new AbortController(),
      isolation: "worktree",
    });

    expect(createWorktree).toHaveBeenCalledTimes(1);
    expect(cleanupWorktree).toHaveBeenCalledWith("/tmp/subagent-worktree");
  });
});

describe("TeammateIdle continuation", () => {
  it("resumes the same member with hook feedback before completing", async () => {
    getCurrentTeamRunMember.mockImplementation((name: string) =>
      name === "implementer" ? { runId: "run-1" } : undefined,
    );
    const reports = ["first report", "fixed report"];
    runAgentTurn.mockImplementation(async ({ chatHistory }: any) => {
      const report = reports.shift() ?? "done";
      chatHistory.push({
        message: { role: "assistant", content: report },
        contextItems: [],
      });
      return report;
    });
    teammateIdle.mockResolvedValueOnce({
      blocked: true,
      blockReason: "Add the missing tests.",
      results: [],
    });

    const result = await executeSubAgent({
      agent: state("implementer"),
      prompt: "do the work",
      parentSessionId: "root",
      abortController: new AbortController(),
    });

    expect(result.success).toBe(true);
    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(runAgentTurn.mock.calls[1][0].chatHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.stringContaining("Add the missing tests."),
          }),
        }),
      ]),
    );
    expect(finishTeamMemberRun).toHaveBeenCalledTimes(1);
    expect(finishTeamMemberRun).toHaveBeenCalledWith(
      "run-1",
      "implementer",
      expect.objectContaining({ success: true, report: "fixed report" }),
    );
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
