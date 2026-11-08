import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import type { ModelServiceState } from "../services/types.js";
import {
  clearSessionTeamModelOverride,
  getSessionTeamModelOverride,
  setSessionActiveTeam,
  setSessionTeamModelOverride,
} from "../session/index.js";
import { DEFAULT_TEAMS } from "../team/defaultTeams.js";
import type { TeamDefinition } from "../team/loader.js";

import { assignTeamModelTool } from "./assignTeamModel.js";
import { getAllAvailableTools } from "./registry.js";
import { listSubagentsTool } from "./subagent.js";
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

beforeEach(() => {
  serviceContainer.registerValue(SERVICE_NAMES.MODEL, modelState() as never);
  clearSessionTeamModelOverride();
  setSessionActiveTeam("dev");
});

afterEach(() => {
  clearSessionTeamModelOverride();
  setSessionActiveTeam(undefined);
});

describe("AssignTeamModel", () => {
  it("records a model for a member of the active team", async () => {
    const tool = await assignTeamModelTool();

    const result = await tool.run({
      member: "implementer",
      model: "cheap-model",
    });

    expect(result).toContain("implementer");
    expect(getSessionTeamModelOverride("implementer")).toBe("cheap-model");
  });

  it("accepts a configured model id as well as its entry name", async () => {
    const tool = await assignTeamModelTool();

    await tool.run({ member: "implementer", model: "haiku" });

    expect(getSessionTeamModelOverride("implementer")).toBe("haiku");
  });

  it("rejects a member that is not on the active team", async () => {
    const tool = await assignTeamModelTool();

    await expect(
      tool.run({ member: "no-such-member", model: "cheap-model" }),
    ).rejects.toThrow(/not in the active team/);
  });

  it("rejects a model the configuration does not define", async () => {
    const tool = await assignTeamModelTool();

    await expect(
      tool.run({ member: "implementer", model: "ghost-model" }),
    ).rejects.toThrow(/Unknown model "ghost-model"/);
  });

  it("refuses to assign anything when no team is active", async () => {
    setSessionActiveTeam(undefined);
    const tool = await assignTeamModelTool();

    await expect(
      tool.run({ member: "implementer", model: "cheap-model" }),
    ).rejects.toThrow(/No team is active/);
  });
});

describe("AssignTeamModel registration", () => {
  it("is offered only with the beta delegation flag and an active team", async () => {
    serviceContainer.registerValue(SERVICE_NAMES.MCP, {
      connections: [],
      tools: [],
    } as never);
    setBetaSubagentToolEnabled(true);
    try {
      const withTeam = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      expect(withTeam).toContain("AssignTeamModel");

      setSessionActiveTeam(undefined);
      const withoutTeam = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      expect(withoutTeam).not.toContain("AssignTeamModel");
    } finally {
      setBetaSubagentToolEnabled(false);
    }
  });
});

describe("the session override map", () => {
  it("clears one member without disturbing the others", () => {
    setSessionTeamModelOverride("implementer", "cheap-model", {
      activeTeam: devTeam(),
      modelState: modelState(),
    });
    setSessionTeamModelOverride("tester", "cheap-model", {
      activeTeam: devTeam(),
      modelState: modelState(),
    });

    clearSessionTeamModelOverride("implementer");

    expect(getSessionTeamModelOverride("implementer")).toBeUndefined();
    expect(getSessionTeamModelOverride("tester")).toBe("cheap-model");
  });
});

describe("ListSubagents after an assignment", () => {
  it("shows the member's effective model and the override marker", async () => {
    setSessionTeamModelOverride("implementer", "cheap-model", {
      activeTeam: devTeam(),
      modelState: modelState(),
    });

    const tool = await listSubagentsTool();
    const output = await tool.run({});
    const description = devTeam().members.find(
      (member) => member.name === "implementer",
    )!.description;

    expect(output).toContain(
      `- implementer: ${description} [model: cheap-model (assigned)]`,
    );
  });

  it("shows the session model when the roster names none", async () => {
    const tool = await listSubagentsTool();
    const output = await tool.run({});

    expect(output).toContain("[model: work-model]");
  });
});
