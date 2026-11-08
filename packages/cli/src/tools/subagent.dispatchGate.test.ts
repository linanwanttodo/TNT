import { beforeEach, describe, expect, it, vi } from "vitest";

const activeTeam = vi.hoisted(() => ({
  value: "dev" as string | undefined,
}));
const sessionOverrides = vi.hoisted(() => ({
  value: {} as Record<string, string>,
}));
vi.mock("../session/index.js", () => ({
  getSessionActiveTeam: vi.fn(() => activeTeam.value),
  getSessionTeamModelOverride: vi.fn(
    (name: string) => sessionOverrides.value[name],
  ),
  getSessionTeamModelOverrides: vi.fn(() =>
    Object.keys(sessionOverrides.value).length > 0
      ? { ...sessionOverrides.value }
      : undefined,
  ),
}));
vi.mock("../subagent/executor.js", () => ({
  executeSubAgent: vi.fn(async () => ({
    success: true,
    response: "done",
  })),
}));
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn(async () => undefined),
  },
}));
vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: {
      getSessionId: vi.fn(() => "parent-session-id"),
      addToolResult: vi.fn(),
    },
  },
}));

import { serviceContainer } from "../services/ServiceContainer.js";
import type { ModelServiceState } from "../services/types.js";
import { executeSubAgent } from "../subagent/executor.js";
import { DEFAULT_TEAMS } from "../team/defaultTeams.js";
import type { TeamDefinition } from "../team/loader.js";
import { logger } from "../utils/logger.js";

import { resolveAgentState, subagentTool } from "./subagent.js";

const sessionModel = {
  name: "work-model",
  provider: "openai",
  model: "gpt-x",
  roles: ["chat"],
} as any;

function stateOf(): ModelServiceState {
  return {
    llmApi: {} as any,
    model: sessionModel,
    assistant: null,
  } as unknown as ModelServiceState;
}

const cheapModel = {
  name: "cheap-model",
  provider: "openai",
  model: "haiku",
  roles: ["chat"],
  chatOptions: {},
};

function stateWithModels(
  models: unknown[],
  overrides: Record<string, unknown> = {},
): ModelServiceState {
  return {
    llmApi: {} as any,
    model: sessionModel,
    assistant: { models },
    ...overrides,
  } as unknown as ModelServiceState;
}

function devTeamWithImplementerModel(model?: string): TeamDefinition {
  const dev = DEFAULT_TEAMS.find((team) => team.name === "dev")!;
  return {
    ...dev,
    members: dev.members.map((member) =>
      member.name === "implementer"
        ? { ...member, ...(model ? { model } : {}) }
        : member,
    ),
  };
}

beforeEach(() => {
  sessionOverrides.value = {};
});

describe("dispatching a listed team member", () => {
  it("preprocess accepts a team member name the model service does not know", async () => {
    vi.mocked(serviceContainer.get).mockResolvedValue(stateOf());

    const tool = await subagentTool();

    const result = await tool.preprocess!({
      description: "implement the change",
      prompt: "do it",
      subagent_name: "implementer",
    });

    expect(result.preview?.[0]).toMatchObject({
      type: "text",
      content: expect.stringContaining("implementer"),
    });
  });

  it("runs a team member on a synthesized state carrying the roster prompt", async () => {
    vi.mocked(serviceContainer.get).mockResolvedValue(stateOf());

    const tool = await subagentTool();

    await tool.run(
      { prompt: "do it", subagent_name: "implementer" },
      { toolCallId: "call-1", parallelToolCallCount: 1 },
    );

    const options = vi.mocked(executeSubAgent).mock.calls[0][0];
    expect(options.agent.model?.name).toBe("implementer");
    expect(options.agent.model?.chatOptions?.baseSystemMessage).toContain(
      "先写失败的测试",
    );
  });

  it("still throws for a name nothing resolves", async () => {
    vi.mocked(serviceContainer.get).mockResolvedValue(stateOf());

    const tool = await subagentTool();

    await expect(
      tool.preprocess!({
        description: "x",
        prompt: "y",
        subagent_name: "no-such-agent",
      }),
    ).rejects.toThrow();
  });
});

describe("a team member's assigned model", () => {
  it("runs the member on the model its roster names", () => {
    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel("cheap-model"),
    );

    expect(agent?.model?.name).toBe("implementer");
    expect(agent?.model?.model).toBe("haiku");
    expect(agent?.model?.provider).toBe("openai");
    // The roster persona stays the base system message on the assigned model.
    expect(agent?.model?.chatOptions?.baseSystemMessage).toContain(
      "先写失败的测试",
    );
  });

  it("matches the assigned name against the model id as well as the entry name", () => {
    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel("haiku"),
    );

    expect(agent?.model?.model).toBe("haiku");
    expect(agent?.model?.chatOptions?.baseSystemMessage).toContain(
      "先写失败的测试",
    );
  });

  it("inherits the session model when the member names none", () => {
    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel(),
    );

    expect(agent?.model?.model).toBe("gpt-x");
    expect(agent?.model?.chatOptions?.baseSystemMessage).toContain(
      "先写失败的测试",
    );
  });

  it("falls back to the session model when the named model is unknown", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel("ghost-model"),
    );

    expect(agent?.model?.model).toBe("gpt-x");
    expect(agent?.model?.chatOptions?.baseSystemMessage).toContain(
      "先写失败的测试",
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost-model"));
  });

  it("lets a configured agent of the same name shadow the member and its model", () => {
    const configured = {
      name: "implementer",
      provider: "anthropic",
      model: "claude-configured",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "configured implementer persona" },
    };

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([configured]),
      devTeamWithImplementerModel("cheap-model"),
    );

    expect(agent?.model?.model).toBe("claude-configured");
    expect(agent?.model?.chatOptions?.baseSystemMessage).toBe(
      "configured implementer persona",
    );
  });

  it("runs the member on a model the main agent assigned for this session", () => {
    sessionOverrides.value = { implementer: "cheap-model" };
    const rosterPersona = devTeamWithImplementerModel().members.find(
      (member) => member.name === "implementer",
    )!.systemMessage;

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel(),
    );

    expect(agent?.model?.model).toBe("haiku");
    // The assignment changes the model, never the roster persona.
    expect(agent?.model?.chatOptions?.baseSystemMessage).toBe(rosterPersona);
  });

  it("puts the session assignment ahead of the roster's model", () => {
    sessionOverrides.value = { implementer: "cheap-model" };

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel("work-model"),
    );

    expect(agent?.model?.model).toBe("haiku");
  });

  it("keeps the configured same-name agent ahead of a session assignment", () => {
    const configured = {
      name: "implementer",
      provider: "anthropic",
      model: "claude-configured",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "configured implementer persona" },
    };
    sessionOverrides.value = { implementer: "cheap-model" };

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([configured, cheapModel]),
      devTeamWithImplementerModel(),
    );

    expect(agent?.model?.model).toBe("claude-configured");
    expect(agent?.model?.chatOptions?.baseSystemMessage).toBe(
      "configured implementer persona",
    );
  });

  it("falls back to the session model when an assignment outlives its model", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    sessionOverrides.value = { implementer: "retired-model" };

    const agent = resolveAgentState(
      "implementer",
      stateWithModels([cheapModel]),
      devTeamWithImplementerModel(),
    );

    expect(agent?.model?.model).toBe("gpt-x");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("retired-model"));
  });
});
