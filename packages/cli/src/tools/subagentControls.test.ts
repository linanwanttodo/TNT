import { beforeEach, describe, expect, it, vi } from "vitest";

const currentSession = vi.hoisted(() => ({ id: "parent-1" }));
const listSubagentRuns = vi.hoisted(() => vi.fn());
const stopSubagentRun = vi.hoisted(() => vi.fn());
const resumeSubagentRun = vi.hoisted(() => vi.fn());
const requestParentInput = vi.hoisted(() => vi.fn());
const resolveAgentState = vi.hoisted(() => vi.fn());
const loadSessionById = vi.hoisted(() => vi.fn());

vi.mock("../subagent/asyncExecutor.js", () => ({
  listSubagentRuns,
  stopSubagentRun,
  resumeSubagentRun,
}));
vi.mock("../subagent/runtime/pingHandler.js", () => ({ requestParentInput }));
vi.mock("../subagent/runtime/injector.js", () => ({
  readSubagentTranscript: vi.fn(() => null),
}));
vi.mock("./subagent.js", () => ({ resolveAgentState }));
vi.mock("../session/index.js", () => ({ loadSessionById }));
vi.mock("../services/index.js", () => ({
  services: { chatHistory: { getSessionId: () => currentSession.id } },
}));
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: { get: vi.fn(async () => ({ model: { name: "chat" } })) },
}));

import { runInDispatchScope } from "../subagent/dispatchScope.js";

import {
  sendMessageTool,
  taskOutputTool,
  taskStopTool,
} from "./subagentControls.js";

beforeEach(() => {
  vi.clearAllMocks();
  currentSession.id = "parent-1";
});

describe("subagent control tools", () => {
  it("lists live runs for the current parent", async () => {
    listSubagentRuns.mockReturnValue([
      {
        runId: "run-1",
        sessionId: "child-1",
        parentSessionId: "parent-1",
        agentType: "explore",
        status: "running",
      },
    ]);

    const output = await taskOutputTool.run({});

    expect(output).toContain("run-1");
    expect(output).toContain("child-1");
    expect(output).toContain("running");
  });

  it("stops only the selected child run", async () => {
    stopSubagentRun.mockReturnValue(true);

    const output = await taskStopTool.run({ run_id: "run-1" });

    expect(stopSubagentRun).toHaveBeenCalledWith("run-1", "parent-1");
    expect(output).toContain("Stopped");
  });

  it("lets a child pause itself with a parent question", async () => {
    const runtime = {
      runId: "run-1",
      sessionId: "child-1",
      parentSessionId: "parent-1",
      agentType: "explore",
      abortController: new AbortController(),
    } as any;

    const output = await runInDispatchScope(
      { context: {} as any, maxDelegationDepth: 3, runtime },
      () =>
        sendMessageTool.run({ recipient: "parent", message: "Which file?" }),
    );

    expect(requestParentInput).toHaveBeenCalledWith(runtime, "Which file?");
    expect(output).toContain("Waiting for parent input");
  });

  it("resumes a persisted child with a follow-up message", async () => {
    loadSessionById.mockReturnValue({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      subagentType: "explore",
      history: [],
    });
    resolveAgentState.mockReturnValue({ model: { name: "explore" } });
    resumeSubagentRun.mockResolvedValue({
      runId: "run-2",
      sessionId: "child-1",
      status: "running",
    });

    const output = await sendMessageTool.run({
      session_id: "child-1",
      message: "Check tests too",
    });

    expect(resumeSubagentRun).toHaveBeenCalledWith(
      "child-1",
      "Check tests too",
      expect.objectContaining({ parentSessionId: "parent-1" }),
    );
    expect(output).toContain("run-2");
  });

  it("does not read or stop another parent's run", async () => {
    const foreign = {
      runId: "foreign-run",
      sessionId: "foreign-child",
      parentSessionId: "foreign-parent",
      agentType: "explore",
      status: "done",
      result: { success: true, response: "foreign report" },
    };
    listSubagentRuns.mockImplementation((parent?: string) =>
      parent === "foreign-parent" ? [foreign] : [],
    );
    stopSubagentRun.mockImplementation(
      (_runId: string, parent?: string) => parent === "foreign-parent",
    );

    expect(await taskOutputTool.run({ run_id: "foreign-run" })).toContain(
      "not found or not owned",
    );
    expect(await taskStopTool.run({ run_id: "foreign-run" })).toContain(
      "not running",
    );
    expect(stopSubagentRun).toHaveBeenCalledWith("foreign-run", "parent-1");
  });

  it("does not steer another parent's child", async () => {
    listSubagentRuns.mockReturnValue([
      {
        runId: "foreign-run",
        sessionId: "foreign-child",
        parentSessionId: "foreign-parent",
        agentType: "explore",
        status: "done",
      },
    ]);
    loadSessionById.mockReturnValue({
      sessionId: "foreign-child",
      parentSessionId: "foreign-parent",
      subagentType: "explore",
      history: [],
    });

    expect(
      await sendMessageTool.run({
        session_id: "foreign-child",
        message: "inject this",
      }),
    ).toContain("not found or not owned");
    expect(resumeSubagentRun).not.toHaveBeenCalled();
  });

  it("does not resume a root session as a child", async () => {
    loadSessionById.mockReturnValue({
      sessionId: "root-session",
      history: [],
    });

    expect(
      await sendMessageTool.run({
        session_id: "root-session",
        message: "inject this",
      }),
    ).toContain("Child session not found");
    expect(resumeSubagentRun).not.toHaveBeenCalled();
  });

  it("lets a team member message a sibling in the same team", async () => {
    currentSession.id = "child-1";
    const runtime = {
      runId: "run-1",
      sessionId: "child-1",
      parentSessionId: "parent-1",
      agentType: "explore",
      teamRunId: "team-1",
      abortController: new AbortController(),
    } as any;
    const sibling = {
      runId: "run-2",
      sessionId: "child-2",
      parentSessionId: "parent-1",
      agentType: "tester",
      teamRunId: "team-1",
      status: "running",
      agent: { model: { name: "tester" } },
    } as any;
    listSubagentRuns.mockReturnValue([sibling]);
    loadSessionById.mockReturnValue({
      sessionId: "child-2",
      parentSessionId: "parent-1",
      subagentType: "tester",
      history: [],
    });

    const output = await runInDispatchScope(
      { context: {} as any, maxDelegationDepth: 3, runtime },
      () =>
        sendMessageTool.run({
          session_id: "child-2",
          message: "Check the new endpoint.",
        }),
    );

    expect(output).toContain("Message sent");
    expect(resumeSubagentRun).toHaveBeenCalledWith(
      "child-2",
      "Check the new endpoint.",
      expect.objectContaining({
        parentSessionId: "parent-1",
        requesterSessionId: "child-1",
      }),
    );
  });
});
