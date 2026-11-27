import { beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import {
  dispatchSubAgent,
  resumeSubagentRun,
} from "../subagent/asyncExecutor.js";
import { executeSubAgent } from "../subagent/executor.js";
import {
  getAgentNames,
  resolveDispatchableAgent,
} from "../subagent/get-agents.js";
import { SUBAGENT_TOOL_META } from "../subagent/index.js";

import { subagentTool } from "./subagent.js";

vi.mock("../subagent/get-agents.js");
vi.mock("../subagent/executor.js");
vi.mock("../subagent/asyncExecutor.js");
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn(),
  },
}));
vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: {
      getSessionId: vi.fn().mockReturnValue("parent-session-id"),
      addToolResult: vi.fn(),
    },
  },
}));

describe("subagentTool", () => {
  const sessionModel = {
    name: "work-model",
    provider: "openai",
    model: "gpt-x",
    roles: ["chat"],
  };
  const configuredAgent = {
    ...sessionModel,
    name: "test-model",
    roles: ["subagent"],
    chatOptions: { baseSystemMessage: "persona" },
  };
  const modelServiceState = {
    model: sessionModel,
    llmApi: null,
    assistant: { models: [configuredAgent] },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDispatchableAgent).mockReset();
    vi.mocked(serviceContainer.get).mockResolvedValue(modelServiceState);
  });

  it("preprocess throws when agent is not found", async () => {
    vi.mocked(getAgentNames).mockReturnValue(["code-agent"]);

    const tool = await subagentTool();

    const args = {
      description: "Test task",
      prompt: "Do something",
      subagent_name: "unknown-agent",
    };

    await expect(tool.preprocess!(args)).rejects.toThrow(
      "Unknown agent type: unknown-agent",
    );
  });

  it("preprocess includes agent model name when agent exists", async () => {
    const tool = await subagentTool();

    const args = {
      description: "Handle specialized task",
      prompt: "Do it",
      subagent_name: "test-model",
    };

    const result = await tool.preprocess!(args);

    expect(result.preview).toEqual([
      {
        type: "text",
        content: "Spawning test-model to: Handle specialized task",
      },
    ]);
  });

  it("passes markdown isolation and runtime limits to foreground execution", async () => {
    vi.mocked(resolveDispatchableAgent).mockReturnValue({
      systemMessage: "persona",
      kind: "markdown",
      maxTurns: 4,
      allowedTools: ["Read", "Search"],
      permissionMode: "plan",
      skills: ["review"],
      isolation: "worktree",
    });
    vi.mocked(executeSubAgent).mockResolvedValue({
      success: true,
      response: "subagent-output",
    } as any);

    const tool = await subagentTool();
    await tool.run(
      {
        description: "Inspect safely",
        prompt: "Inspect the implementation",
        subagent_name: "test-model",
        run_in_background: false,
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    expect(executeSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTurns: 4,
        allowedTools: ["Read", "Search"],
        permissionMode: "plan",
        skills: ["review"],
        isolation: "worktree",
      }),
    );
  });

  it("allows an explicit isolation argument to override the agent default", async () => {
    vi.mocked(resolveDispatchableAgent).mockReturnValue({
      systemMessage: "persona",
      kind: "markdown",
      isolation: "worktree",
    });
    vi.mocked(dispatchSubAgent).mockResolvedValue({
      runId: "run-isolated",
      sessionId: "child-isolated",
      realmId: 1,
      status: "running",
    });

    const tool = await subagentTool();
    await tool.run(
      {
        description: "Inspect safely",
        prompt: "Inspect the implementation",
        subagent_name: "test-model",
        isolation: "worktree",
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    expect(dispatchSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ isolation: "worktree" }),
    );
  });

  it("run executes subagent and returns formatted output", async () => {
    vi.mocked(executeSubAgent).mockResolvedValue({
      success: true,
      response: "subagent-output",
    } as any);

    const tool = await subagentTool();

    const result = await tool.run(
      {
        description: "Test task",
        files: ["src/example.ts"],
        prompt: "Subagent prompt",
        subagent_name: "test-model",
        run_in_background: false,
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    expect(vi.mocked(executeSubAgent)).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(executeSubAgent).mock.calls[0];
    expect(options.agent.model?.name).toBe("test-model");

    // A terse prompt is expanded, with the caller's text kept verbatim.
    expect(options.prompt).toContain(
      "Objective (verbatim from the caller):\nSubagent prompt",
    );
    expect(options.prompt).toContain("Scope (files): src/example.ts");
    expect(options.prompt).toContain("Report:");
    expect(options.parentSessionId).toBe("parent-session-id");
    expect(typeof options.onOutputUpdate).toBe("function");

    options.onOutputUpdate?.("partial-output");
    expect(vi.mocked(services.chatHistory.addToolResult)).toHaveBeenCalledWith(
      "tool-call-id",
      "partial-output",
      "calling",
    );

    expect(result).toContain("subagent-output");
    expect(result).toContain(
      "<task_metadata>\nstatus: completed\n</task_metadata>",
    );
    // The caller can inspect what the child was actually sent.
    expect(result).toContain("Brief:\n");
    expect(result).toContain("Objective (verbatim from the caller):");
  });

  it("passes a structured prompt through unchanged and does not echo it", async () => {
    const structured = [
      "Objective: fix the parser bug.",
      "",
      "Scope:",
      "- src/parser.ts",
      "",
      "Report: what changed and the test output.",
    ].join("\n");
    vi.mocked(executeSubAgent).mockResolvedValue({
      success: true,
      response: "subagent-output",
    } as any);

    const tool = await subagentTool();
    const result = await tool.run(
      {
        prompt: structured,
        subagent_name: "test-model",
        run_in_background: false,
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    const [options] = vi.mocked(executeSubAgent).mock.calls[0];
    expect(options.prompt).toBe(structured);
    expect(result).not.toContain("Brief:");
  });

  it("puts the member's restriction and denied tools in the brief", async () => {
    vi.mocked(resolveDispatchableAgent).mockReturnValue({
      systemMessage: "persona",
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      kind: "model",
    });
    vi.mocked(executeSubAgent).mockResolvedValue({
      success: true,
      response: "subagent-output",
    } as any);

    const tool = await subagentTool();
    await tool.run(
      {
        prompt: "run the parser tests",
        subagent_name: "test-model",
        run_in_background: false,
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    const [options] = vi.mocked(executeSubAgent).mock.calls[0];
    expect(options.prompt).toContain("No file writes:");
    expect(options.prompt).toContain("Unavailable tools: AskQuestion, Exit.");
  });

  it("dispatches in the background by default and returns the run id", async () => {
    vi.mocked(dispatchSubAgent).mockResolvedValue({
      runId: "run-1",
      sessionId: "child-1",
      realmId: 1,
      status: "running",
    });
    const tool = await subagentTool();

    const result = await tool.run(
      { prompt: "inspect the repo", subagent_name: "test-model" },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    expect(dispatchSubAgent).toHaveBeenCalledTimes(1);
    expect(executeSubAgent).not.toHaveBeenCalled();
    expect(result).toContain("run-1");
    expect(result).toContain("child-1");
  });

  it("continues a previous child session when session_id is supplied", async () => {
    vi.mocked(resumeSubagentRun).mockResolvedValue({
      runId: "run-2",
      sessionId: "child-1",
      realmId: 1,
      status: "running",
    });
    const tool = await subagentTool();

    const result = await tool.run({
      prompt: "continue the investigation",
      subagent_name: "test-model",
      session_id: "child-1",
    });

    expect(resumeSubagentRun).toHaveBeenCalledWith(
      "child-1",
      expect.stringContaining("continue the investigation"),
      expect.objectContaining({ parentSessionId: "parent-session-id" }),
    );
    expect(result).toContain("run-2");
  });

  it("does not change the delegation schema or required parameters", async () => {
    const tool = await subagentTool();

    expect(tool.parameters.required).toEqual(
      SUBAGENT_TOOL_META.parameters.required,
    );
    expect(Object.keys(tool.parameters.properties).sort()).toEqual(
      Object.keys(SUBAGENT_TOOL_META.parameters.properties).sort(),
    );
  });

  it("carries the verdict a verification agent reported", async () => {
    const verificationModel = {
      ...sessionModel,
      name: "verification",
      roles: ["subagent"],
      chatOptions: { baseSystemMessage: "verifier persona" },
    };
    vi.mocked(serviceContainer.get).mockResolvedValue({
      ...modelServiceState,
      assistant: { models: [verificationModel] },
    } as any);
    vi.mocked(executeSubAgent).mockResolvedValue({
      success: true,
      response: "build ok\nVERDICT: PASS",
      verdict: "pass",
    } as any);

    const tool = await subagentTool();

    const result = await tool.run(
      {
        prompt: "verify the change",
        subagent_name: "verification",
        run_in_background: false,
      },
      { toolCallId: "tool-call-id", parallelToolCallCount: 1 },
    );

    // The caller branches on this line instead of re-reading the report.
    expect(result).toContain("status: completed");
    expect(result).toContain("verdict: pass");
  });
});
