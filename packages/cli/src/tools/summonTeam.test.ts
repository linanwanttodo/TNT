import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teamsValue = vi.hoisted(() => ({
  value: [] as unknown[],
}));
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../subagent/executor.js", () => ({
  executeSubAgent: executeMock,
}));

vi.mock("../team/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../team/loader.js")>();
  return { ...actual, loadTeams: vi.fn(() => teamsValue.value) };
});

import { services } from "../services/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import type { ModelServiceState } from "../services/types.js";
import { SERVICE_NAMES } from "../services/types.js";
import {
  clearSessionTeamModelOverride,
  clearSessionTeamRuns,
  getSessionTeamRuns,
  MAX_TEAM_RUN_MEMBERS,
  setSessionActiveTeam,
  setSessionTeamModelOverride,
} from "../session/index.js";
import { resolveDispatchableAgent } from "../subagent/get-agents.js";
import { DEFAULT_TEAMS } from "../team/defaultTeams.js";
import type { TeamDefinition } from "../team/loader.js";

import { getAllAvailableTools } from "./registry.js";
import { composeLeadBrief, summonTeamTool } from "./team.js";
import { setBetaSubagentToolEnabled } from "./toolsConfig.js";

const sessionModel = {
  name: "work-model",
  provider: "openai",
  model: "gpt-x",
  roles: ["chat"],
} as any;

const cheapModel = {
  name: "cheap-model",
  provider: "openai",
  model: "haiku",
  roles: ["chat"],
  chatOptions: {},
} as any;

function modelState(): ModelServiceState {
  return {
    llmApi: null,
    model: sessionModel,
    assistant: { models: [cheapModel] },
  } as unknown as ModelServiceState;
}

function devTeam(): TeamDefinition {
  return DEFAULT_TEAMS.find((team) => team.name === "dev")!;
}

function teamWithLeadModel(model: string): TeamDefinition {
  const dev = devTeam();
  return {
    ...dev,
    lead: { ...dev.lead, model },
    members: dev.members.map((member) =>
      member.name === dev.lead.name ? { ...member, model } : member,
    ),
  };
}

function parentSession(): void {
  vi.spyOn(services.chatHistory, "getSessionId").mockReturnValue(
    "parent-session-id",
  );
  vi.spyOn(services.chatHistory, "addToolResult").mockReturnValue(undefined);
}

beforeEach(() => {
  teamsValue.value = [devTeam()];
  setSessionActiveTeam("dev");
  clearSessionTeamModelOverride();
  clearSessionTeamRuns();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ success: true, response: "lead report" });
  serviceContainer.registerValue(SERVICE_NAMES.MODEL, modelState() as never);
  serviceContainer.registerValue(SERVICE_NAMES.MCP, {
    connections: [],
    tools: [],
  } as never);
});

afterEach(() => {
  clearSessionTeamModelOverride();
  clearSessionTeamRuns();
  setSessionActiveTeam(undefined);
  teamsValue.value = [];
  vi.restoreAllMocks();
});

describe("SummonTeam registration", () => {
  it("is offered only with the beta delegation flag, delegation and an active team", async () => {
    setBetaSubagentToolEnabled(true);
    try {
      const withTeam = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      expect(withTeam).toContain("SummonTeam");

      setSessionActiveTeam(undefined);
      const withoutTeam = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      expect(withoutTeam).not.toContain("SummonTeam");

      setSessionActiveTeam("dev");
      const noDelegate = (await getAllAvailableTools(false, false)).map(
        (tool) => tool.name,
      );
      expect(noDelegate).not.toContain("SummonTeam");

      setBetaSubagentToolEnabled(false);
      const noBeta = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      expect(noBeta).not.toContain("SummonTeam");
    } finally {
      setBetaSubagentToolEnabled(false);
    }
  });
});

describe("the lead brief", () => {
  it("carries the goal and the roster descriptions, without the lead", () => {
    const brief = composeLeadBrief(devTeam(), "ship the feature");

    expect(brief).toContain("ship the feature");
    expect(brief).toContain("You are the lead of the dev team.");
    for (const member of devTeam().members.filter((m) => !m.lead)) {
      expect(brief).toContain(`- ${member.name}: ${member.description}`);
    }
    expect(brief).not.toContain("- project-manager:");
    expect(brief).toContain("Subagent tool");
  });

  it("tells a serial lead to run the members one at a time, in order", () => {
    const brief = composeLeadBrief(devTeam(), "ship the feature", {
      mode: "serial",
    });

    expect(brief).toContain("Run strategy: serial");
    expect(brief).toContain("one at a time, in the order listed");
    expect(brief).toContain("do not start a member until the previous");
  });

  it("tells a parallel lead to dispatch non-overlapping members together", () => {
    const brief = composeLeadBrief(devTeam(), "ship the feature", {
      mode: "parallel",
    });

    expect(brief).toContain("Run strategy: parallel");
    expect(brief).toContain("together in one batch");
    expect(brief).toContain("non-overlapping scopes run together");
  });

  it("lets an auto lead decide the order", () => {
    const brief = composeLeadBrief(devTeam(), "ship the feature", {
      mode: "auto",
    });

    expect(brief).toContain("Run strategy: auto");
    expect(brief).toContain("Decide the order yourself");
  });

  it("lists only the requested members and says so", () => {
    const team = devTeam();
    const implementer = team.members.find((m) => m.name === "implementer")!;
    const brief = composeLeadBrief(team, "ship the feature", {
      members: [implementer],
    });

    expect(brief).toContain(`- implementer: ${implementer.description}`);
    expect(brief).not.toContain("- tester:");
    expect(brief).toContain("Only these members are in scope for this run");
  });
});

describe("SummonTeam", () => {
  it("runs the lead with its persona and returns the lead report", async () => {
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({ goal: "ship the feature" });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const options = executeMock.mock.calls[0][0];
    expect(options.parentSessionId).toBe("parent-session-id");
    expect(options.agent.model.name).toBe("project-manager");
    expect(options.agent.model.chatOptions.baseSystemMessage).toContain(
      "你是 dev 团队的管理者",
    );
    expect(options.prompt).toContain("ship the feature");
    expect(options.prompt).toContain(
      devTeam().members.find((m) => m.name === "implementer")!.description,
    );

    // The dispatched name resolves to the lead's roster restriction in the
    // same dispatch chain the Subagent tool uses.
    const dispatchable = resolveDispatchableAgent(
      options.agent.model.name,
      options.agent,
      devTeam(),
    );
    expect(dispatchable?.restriction).toBe("readonly");

    expect(output).toContain("lead report");
    expect(output).toContain("status: completed");
  });

  it("runs the lead on the roster's model", async () => {
    parentSession();
    teamsValue.value = [teamWithLeadModel("cheap-model")];
    const tool = await summonTeamTool();

    await tool.run({ goal: "ship the feature" });

    const options = executeMock.mock.calls[0][0];
    expect(options.agent.model.model).toBe("haiku");
    expect(options.agent.model.name).toBe("project-manager");
  });

  it("runs the lead on a model the main agent assigned", async () => {
    parentSession();
    setSessionTeamModelOverride("project-manager", "cheap-model");
    const tool = await summonTeamTool();

    await tool.run({ goal: "ship the feature" });

    const options = executeMock.mock.calls[0][0];
    expect(options.agent.model.model).toBe("haiku");
    expect(options.agent.model.chatOptions.baseSystemMessage).toContain(
      "你是 dev 团队的管理者",
    );
  });

  it("streams the lead's output against the tool call", async () => {
    parentSession();
    const tool = await summonTeamTool();

    await tool.run(
      { goal: "ship the feature" },
      { toolCallId: "call-1", parallelToolCallCount: 1 },
    );

    const options = executeMock.mock.calls[0][0];
    options.onOutputUpdate("partial");
    expect(services.chatHistory.addToolResult).toHaveBeenCalledWith(
      "call-1",
      "partial",
      "calling",
    );
  });

  it("defaults to auto over every non-lead member and opens the ledger", async () => {
    parentSession();
    const tool = await summonTeamTool();

    await tool.run({ goal: "ship the feature" });

    const options = executeMock.mock.calls[0][0];
    expect(options.maxDelegationDepth).toBe(2);
    expect(options.prompt).toContain("Run strategy: auto");

    const [run] = getSessionTeamRuns();
    expect(run).toMatchObject({
      team: "dev",
      goal: "ship the feature",
      mode: "auto",
      status: "completed",
    });
    expect(run.members.map((member) => member.name)).toEqual(
      devTeam()
        .members.filter((member) => !member.lead)
        .map((member) => member.name),
    );
    expect(run.members.every((member) => member.status === "pending")).toBe(
      true,
    );
  });

  it("passes the chosen mode and member order into the brief and ledger", async () => {
    parentSession();
    const tool = await summonTeamTool();

    await tool.run({
      goal: "ship the feature",
      mode: "serial",
      members: ["tester", "implementer"],
    });

    const options = executeMock.mock.calls[0][0];
    expect(options.prompt).toContain("Run strategy: serial");
    expect(options.prompt.indexOf("- tester:")).toBeLessThan(
      options.prompt.indexOf("- implementer:"),
    );
    expect(options.prompt).not.toContain("- code-reviewer:");

    const [run] = getSessionTeamRuns();
    expect(run.mode).toBe("serial");
    expect(run.members.map((member) => member.name)).toEqual([
      "tester",
      "implementer",
    ]);
  });

  it("marks the ledger run failed when the lead fails", async () => {
    parentSession();
    executeMock.mockResolvedValue({
      success: false,
      response: "",
      error: "lead stopped",
    });
    const tool = await summonTeamTool();

    await tool.run({ goal: "ship the feature" });

    expect(getSessionTeamRuns()[0].status).toBe("failed");
  });

  it("rejects an unknown member before dispatching", async () => {
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({
      goal: "ship the feature",
      members: ["no-such-member"],
    });

    expect(output).toContain("not a dispatchable member");
    expect(executeMock).not.toHaveBeenCalled();
    expect(getSessionTeamRuns()).toEqual([]);
  });

  it("rejects more members than one run may dispatch", async () => {
    parentSession();
    const tool = await summonTeamTool();
    const tooMany = Array.from(
      { length: MAX_TEAM_RUN_MEMBERS + 1 },
      (_, index) => `member-${index}`,
    );

    const output = await tool.run({
      goal: "ship the feature",
      members: tooMany,
    });

    expect(output).toContain(`at most ${MAX_TEAM_RUN_MEMBERS}`);
    expect(executeMock).not.toHaveBeenCalled();
    expect(getSessionTeamRuns()).toEqual([]);
  });

  it("rejects an unknown mode before dispatching", async () => {
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({
      goal: "ship the feature",
      mode: "everyone-at-once",
    });

    expect(output).toContain("Unknown run mode");
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("SummonTeam failures", () => {
  it("returns a clear failure when no team is active", async () => {
    setSessionActiveTeam(undefined);
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({ goal: "ship the feature" });

    expect(output).toContain("No team is active");
    expect(output).toContain("status: failed");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns a clear failure when the active team has no lead", async () => {
    const broken = {
      name: "broken",
      members: devTeam().members.map((member) => ({
        ...member,
        lead: false,
      })),
    };
    teamsValue.value = [broken];
    setSessionActiveTeam("broken");
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({ goal: "ship the feature" });

    expect(output).toContain("Team broken has no lead");
    expect(output).toContain("status: failed");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns the dispatch failure instead of throwing", async () => {
    parentSession();
    executeMock.mockRejectedValue(new Error("model exploded"));
    const tool = await summonTeamTool();

    const output = await tool.run({ goal: "ship the feature" });

    expect(output).toContain("model exploded");
    expect(output).toContain("status: failed");
  });

  it("reports a failed lead run as failed metadata", async () => {
    parentSession();
    executeMock.mockResolvedValue({
      success: false,
      response: "",
      error: "lead stopped",
    });
    const tool = await summonTeamTool();

    const output = await tool.run({ goal: "ship the feature" });

    expect(output).toContain("lead stopped");
    expect(output).toContain("status: failed");
  });

  it("rejects an empty goal without dispatching", async () => {
    parentSession();
    const tool = await summonTeamTool();

    const output = await tool.run({});

    expect(output).toContain("needs a goal");
    expect(output).toContain("status: failed");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
