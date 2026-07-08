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
    setSessionTeamModelOverride("project-manager", "cheap-model", {
      activeTeam: devTeam(),
      modelState: modelState(),
    });
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
