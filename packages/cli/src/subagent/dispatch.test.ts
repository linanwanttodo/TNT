import { describe, expect, it, vi } from "vitest";

vi.mock("../plugins/loader.js", () => ({
  loadAllPlugins: () => ({
    agents: [{ name: "foo:reviewer", content: "plugin reviewer prompt" }],
  }),
}));
vi.mock("../config/index.js", () => ({
  createLlmApi: vi.fn(() => ({ id: "api" })),
  getLlmApi: vi.fn(() => ({ id: "api" })),
  applyOllamaContextWindow: vi.fn(async (model: any) => model),
}));

import type { ModelServiceState } from "../services/types.js";
import type { TeamDefinition } from "../team/loader.js";

import { resolveDispatchableAgent } from "./get-agents.js";

function pluginAgentFor(name: string) {
  return resolveDispatchableAgent(name, stateOf());
}

const sessionModel = {
  name: "work-model",
  provider: "openai",
  model: "gpt-x",
  roles: ["chat"],
  chatOptions: {},
  defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
} as any;

function stateOf(assistantModels: unknown[] = []): ModelServiceState {
  return {
    llmApi: null,
    model: sessionModel,
    assistant: { models: assistantModels },
  } as any;
}

function teamWith(name: string, members: Record<string, unknown>[]) {
  const list = members as any[];
  return {
    name,
    members: list,
    lead: list.find((m) => m.lead),
  } as unknown as TeamDefinition;
}

describe("resolveDispatchableAgent", () => {
  it("resolves a configured model agent as kind model", () => {
    const mine = {
      ...sessionModel,
      name: "researcher",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "my researcher prompt" },
    };

    const agent = resolveDispatchableAgent(
      "researcher",
      stateOf([mine]),
      undefined,
    );

    expect(agent).not.toBeNull();
    expect(agent!.kind).toBe("model");
    expect(agent!.systemMessage).toBe("my researcher prompt");
  });

  it("resolves a built-in role as kind model", () => {
    const agent = resolveDispatchableAgent("verification", stateOf());
    expect(agent).not.toBeNull();
    expect(agent!.kind).toBe("model");
    expect(agent!.systemMessage).toContain("VERDICT: PASS");
    expect(agent!.restriction).toBe("no-writes");
  });

  it("resolves an active team member as kind team", () => {
    const dev = teamWith("dev", [
      {
        name: "implementer",
        description: "writes code",
        team: "dev",
        lead: false,
        systemMessage: "implementer prompt",
      },
    ]);

    const agent = resolveDispatchableAgent("implementer", stateOf(), dev);

    expect(agent).not.toBeNull();
    expect(agent!.kind).toBe("team");
    expect(agent!.systemMessage).toBe("implementer prompt");
  });

  it("carries the model an active team member was assigned", () => {
    const dev = teamWith("dev", [
      {
        name: "implementer",
        description: "writes code",
        team: "dev",
        lead: false,
        model: "cheap-model",
        systemMessage: "implementer prompt",
      },
    ]);

    const agent = resolveDispatchableAgent("implementer", stateOf(), dev);

    expect(agent!.kind).toBe("team");
    expect(agent!.model).toBe("cheap-model");
  });

  it("resolves a team member that references a built-in from the registry", () => {
    const dev = teamWith("dev", [
      {
        name: "team-verifier",
        description: "root cause",
        team: "dev",
        lead: false,
        builtInRef: "verification",
        systemMessage: "",
      },
    ]);

    const agent = resolveDispatchableAgent("team-verifier", stateOf(), dev);

    expect(agent).not.toBeNull();
    expect(agent!.kind).toBe("team");
    expect(agent!.systemMessage).toContain("VERDICT: PASS");
    expect(agent!.restriction).toBe("no-writes");
  });

  it("returns null for a team member when no team is active", () => {
    expect(resolveDispatchableAgent("implementer", stateOf())).toBeNull();
  });

  it("prefers the ModelService entry over an active team member of the same name", () => {
    const mine = {
      ...sessionModel,
      name: "architect",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "configured architect" },
    };
    const dev = teamWith("dev", [
      {
        name: "architect",
        description: "team architect",
        team: "dev",
        lead: false,
        systemMessage: "team architect prompt",
      },
    ]);

    const agent = resolveDispatchableAgent("architect", stateOf([mine]), dev);

    expect(agent!.kind).toBe("model");
    expect(agent!.systemMessage).toBe("configured architect");
  });

  it("resolves a plugin agent by its namespaced name with no-writes default", () => {
    const pluginAgent = pluginAgentFor("plugin:foo:reviewer");
    expect(pluginAgent).not.toBeNull();
    expect(pluginAgent!.kind).toBe("plugin");
    expect(pluginAgent!.systemMessage).toBe("plugin reviewer prompt");
    expect(pluginAgent!.restriction).toBe("no-writes");
  });

  it("returns null for a plugin name no plugin provides", () => {
    expect(pluginAgentFor("plugin:missing:agent")).toBeNull();
  });

  it("returns null for an unknown name", () => {
    expect(resolveDispatchableAgent("nobody", stateOf())).toBeNull();
  });
});

describe("ModelService inheritance sanity", () => {
  it("team members inherit the session model through the shared inherit path", () => {
    expect(sessionModel.model).toBe("gpt-x");
  });
});
