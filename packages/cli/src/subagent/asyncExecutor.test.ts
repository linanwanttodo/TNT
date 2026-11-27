import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetAgentEventBus,
  subscribeAgentEvents,
} from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";

const executeSubAgent = vi.hoisted(() => vi.fn());
const saveSubagentSession = vi.hoisted(() =>
  vi.fn(() => ({
    sessionId: "child-1",
    history: [],
  })),
);
const childSession = vi.hoisted(() => ({
  sessionId: "child-1",
  parentSessionId: "parent-1",
  subagentType: "explore",
  history: [
    { message: { role: "assistant", content: "done" }, contextItems: [] },
  ] as Array<any>,
  pendingSubagentMessages: [] as string[],
}));
const updateSubagentSession = vi.hoisted(() =>
  vi.fn(
    (options: {
      sessionId: string;
      history: any[];
      pendingMessages?: string[];
    }) => {
      childSession.history = options.history;
      if (options.pendingMessages !== undefined) {
        childSession.pendingSubagentMessages = options.pendingMessages;
      }
      return { sessionId: options.sessionId, history: options.history };
    },
  ),
);
const loadSessionById = vi.hoisted(() => vi.fn(() => childSession));

vi.mock("./executor.js", () => ({
  executeSubAgent: (...args: unknown[]) => executeSubAgent(...args),
}));
vi.mock("../session/index.js", () => ({
  saveSubagentSession,
  updateSubagentSession,
  loadSessionById,
  getCurrentSession: () => ({ sessionId: "parent-1", delegationDepth: 0 }),
}));
vi.mock("../realm/realmTree.js", () => ({
  ROOT_REALM: 0,
  realmTree: { fork: vi.fn(() => 7) },
}));
vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearAsyncSubagentRuns,
  dispatchSubAgent,
  getSubagentRun,
  resumeSubagentRun,
  stopSubagentRun,
} from "./asyncExecutor.js";

const agent = { model: { name: "explore" }, llmApi: {}, assistant: {} } as any;
const parentContext = {
  id: "parent-1",
  parentContext: undefined,
  delegationDepth: 0,
  systemMessage: "",
  permissions: { policies: [] },
  mode: "default",
  abortSignal: new AbortController().signal,
} as any;
let events: AgentEvent[];

beforeEach(() => {
  clearAsyncSubagentRuns();
  resetAgentEventBus();
  events = [];
  subscribeAgentEvents((event) => events.push(event));
  childSession.history = [
    { message: { role: "assistant", content: "done" }, contextItems: [] },
  ];
  childSession.pendingSubagentMessages = [];
  executeSubAgent.mockReset();
  saveSubagentSession.mockClear();
  updateSubagentSession.mockClear();
  loadSessionById.mockClear();
});

describe("asynchronous subagent runtime", () => {
  it("returns a run id before the delegated turn finishes", async () => {
    let finish!: (value: { success: boolean; response: string }) => void;
    executeSubAgent.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    expect(dispatched).toMatchObject({
      sessionId: "child-1",
      realmId: 7,
      status: "running",
    });
    expect(getSubagentRun(dispatched.runId)?.status).toBe("running");

    finish({ success: true, response: "report" });
    await vi.waitFor(() => {
      expect(getSubagentRun(dispatched.runId)?.status).toBe("done");
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "notice",
        sessionId: "parent-1",
        message: expect.stringContaining("child-1"),
      }),
    );
  });

  it("stores worktree isolation in the runtime config", async () => {
    executeSubAgent.mockResolvedValue({ success: true, response: "report" });
    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
      isolation: "worktree",
      maxTurns: 5,
    });

    await vi.waitFor(() => {
      expect(getSubagentRun(dispatched.runId)?.status).toBe("done");
    });
    expect(getSubagentRun(dispatched.runId)?.config).toMatchObject({
      isolation: "worktree",
      maxTurns: 5,
    });
    expect(executeSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ isolation: "worktree", maxTurns: 5 }),
    );
  });

  it("preserves the original runtime config when a finished child resumes", async () => {
    executeSubAgent.mockResolvedValue({ success: true, response: "report" });
    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
      isolation: "worktree",
      maxTurns: 5,
      allowedTools: ["Read"],
      permissionMode: "plan",
      skills: ["review"],
    });
    await vi.waitFor(() => {
      expect(getSubagentRun(dispatched.runId)?.status).toBe("done");
    });

    await resumeSubagentRun("child-1", "continue", {
      agent,
      parentSessionId: "parent-1",
      parentContext,
    });
    await vi.waitFor(() => {
      expect(executeSubAgent).toHaveBeenCalledTimes(2);
    });

    expect(executeSubAgent.mock.calls[1][0]).toMatchObject({
      isolation: "worktree",
      maxTurns: 5,
      allowedTools: ["Read"],
      permissionMode: "plan",
      skills: ["review"],
    });
  });

  it("keeps a running steer in the durable inbox across transcript saves", async () => {
    let finish!: (value: { success: boolean; response: string }) => void;
    executeSubAgent
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ success: true, response: "follow-up done" });
    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    await vi.waitFor(() => {
      expect(executeSubAgent).toHaveBeenCalledTimes(1);
    });
    await resumeSubagentRun(dispatched.sessionId, "also check tests", {
      agent,
      parentSessionId: "parent-1",
      parentContext,
    });
    childSession.history = [
      {
        message: { role: "assistant", content: "overwritten" },
        contextItems: [],
      },
    ];
    finish({ success: true, response: "first done" });

    await vi.waitFor(() => {
      expect(executeSubAgent).toHaveBeenCalledTimes(2);
    });
    expect(
      executeSubAgent.mock.calls[1][0].initialHistory.at(-1),
    ).toMatchObject({
      message: { role: "user", content: "also check tests" },
    });
    expect(childSession.pendingSubagentMessages).toEqual([]);
  });

  it("aborts the live child when the parent stops it", async () => {
    executeSubAgent.mockReturnValue(new Promise(() => {}));
    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    expect(stopSubagentRun(dispatched.runId, "other-parent")).toBe(false);
    expect(
      getSubagentRun(dispatched.runId)?.abortController.signal.aborted,
    ).toBe(false);
    expect(stopSubagentRun(dispatched.runId, "parent-1")).toBe(true);
    expect(
      getSubagentRun(dispatched.runId)?.abortController.signal.aborted,
    ).toBe(true);
    expect(getSubagentRun(dispatched.runId)?.result).toEqual({
      success: false,
      response: "",
      error: "Subagent cancelled by user.",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent.finished",
        success: false,
        cancelled: true,
        childSessionId: dispatched.sessionId,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "notice",
        message: expect.stringContaining("cancelled"),
      }),
    );
  });

  it("rejects a root session as a resume target", async () => {
    loadSessionById.mockReturnValueOnce({
      sessionId: "root-session",
      history: [
        { message: { role: "user", content: "original" }, contextItems: [] },
      ],
    } as any);

    const result = await resumeSubagentRun(
      "root-session",
      "injected follow-up",
      {
        agent,
        parentSessionId: "parent-1",
        parentContext,
      },
    );

    expect(result).toBeUndefined();
    expect(executeSubAgent).not.toHaveBeenCalled();
    expect(updateSubagentSession).not.toHaveBeenCalled();
  });

  it("rejects a child owned by another parent", async () => {
    loadSessionById.mockReturnValueOnce({
      ...childSession,
      parentSessionId: "foreign-parent",
    });

    const result = await resumeSubagentRun("child-1", "inject this", {
      agent,
      parentSessionId: "parent-1",
      parentContext,
    });

    expect(result).toBeUndefined();
    expect(executeSubAgent).not.toHaveBeenCalled();
    expect(updateSubagentSession).not.toHaveBeenCalled();
  });

  it("keeps a sibling-resumed run owned by the shared parent", async () => {
    loadSessionById.mockReturnValueOnce(childSession).mockReturnValueOnce({
      sessionId: "child-2",
      parentSessionId: "parent-1",
      subagentType: "tester",
      history: [],
      pendingSubagentMessages: [],
    });
    executeSubAgent.mockResolvedValue({ success: true, response: "done" });

    const result = await resumeSubagentRun("child-1", "check tests", {
      agent,
      parentSessionId: "child-2",
      requesterSessionId: "child-2",
      parentContext,
    });

    expect(result).toBeDefined();
    await vi.waitFor(() => {
      expect(getSubagentRun(result!.runId)?.status).toBe("done");
    });
    expect(getSubagentRun(result!.runId)?.parentSessionId).toBe("parent-1");
  });

  it("resumes the same persisted child session with a follow-up", async () => {
    executeSubAgent.mockResolvedValue({
      success: true,
      response: "first report",
    });
    const dispatched = await dispatchSubAgent({
      agent,
      prompt: "inspect the repo",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });
    await vi.waitFor(() => {
      expect(getSubagentRun(dispatched.runId)?.status).toBe("done");
    });

    await resumeSubagentRun(dispatched.sessionId, "check the tests too", {
      agent,
      parentSessionId: "parent-1",
      parentContext,
    });

    await vi.waitFor(() => {
      expect(executeSubAgent).toHaveBeenCalledTimes(2);
    });
    expect(executeSubAgent.mock.calls[1][0]).toMatchObject({
      childSessionId: "child-1",
      initialHistory: [
        { message: { role: "assistant", content: "done" }, contextItems: [] },
        {
          message: { role: "user", content: "check the tests too" },
          contextItems: [],
        },
      ],
    });
  });
});
