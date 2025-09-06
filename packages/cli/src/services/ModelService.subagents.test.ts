import { describe, expect, it, vi } from "vitest";

vi.mock("../config/index.js", () => ({
  createLlmApi: vi.fn(() => ({ id: "api" })),
  getLlmApi: vi.fn(() => ({ id: "api" })),
}));

import { ModelService } from "./ModelService.js";

const sessionModel = {
  name: "work-model",
  provider: "openai",
  model: "gpt-x",
  roles: ["chat"],
  chatOptions: {},
  defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
} as any;

function stateOf(overrides: Record<string, unknown> = {}) {
  return {
    llmApi: null,
    model: sessionModel,
    assistant: { models: [] },
    authConfig: null,
    ...overrides,
  } as any;
}

describe("subagent registry", () => {
  it("offers the verifier without any configuration", () => {
    const found = ModelService.getSubagentModels(stateOf()).find(
      (entry) => entry.model.name === "verification",
    );

    expect(found?.model.chatOptions?.baseSystemMessage).toContain(
      "VERDICT: PASS",
    );
    expect(found?.model.roles).toEqual(["subagent"]);
    // It runs on the model the session is already using, under its own name.
    expect(found?.model.model).toBe("gpt-x");
  });

  it("keeps a configured agent that takes the same name", () => {
    const mine = {
      ...sessionModel,
      name: "verification",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "my own verifier" },
    };

    const models = ModelService.getSubagentModels(
      stateOf({ assistant: { models: [mine] } }),
    ).filter((entry) => entry.model.name === "verification");

    expect(models).toHaveLength(1);
    expect(models[0]?.model.chatOptions?.baseSystemMessage).toBe(
      "my own verifier",
    );
  });

  it("has nothing to delegate to when no model can run an agent", () => {
    expect(
      ModelService.getSubagentModels(stateOf({ model: null, assistant: null })),
    ).toEqual([]);
  });
});

describe("findModelByName", () => {
  it("matches the entry name and the model id", () => {
    const other = {
      ...sessionModel,
      name: "cheap-model",
      model: "haiku",
    };
    const withModels = stateOf({
      assistant: { models: [sessionModel, other] },
    });

    expect(
      ModelService.findModelByName(withModels, "cheap-model")?.model?.model,
    ).toBe("haiku");
    // Hook authors write whichever of the two identifies the model to them.
    expect(ModelService.findModelByName(withModels, "haiku")?.model?.name).toBe(
      "cheap-model",
    );
  });

  it("returns null for a name nobody configured", () => {
    const withModels = stateOf({ assistant: { models: [sessionModel] } });

    expect(ModelService.findModelByName(withModels, "ghost")).toBeNull();
  });
});
