import { describe, expect, it, vi } from "vitest";

const activeTeam = vi.hoisted(() => ({
  value: "dev" as string | undefined,
}));
vi.mock("../session/index.js", () => ({
  getSessionActiveTeam: vi.fn(() => activeTeam.value),
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

import { subagentTool } from "./subagent.js";

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
