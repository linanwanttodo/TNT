import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetAgentEventBus,
  subscribeAgentEvents,
} from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";
import { sessionStore } from "../session/store.js";

import { executeSubAgent } from "./executor.js";

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn().mockResolvedValue(undefined),
  fireSubagentStop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/index.js", () => ({
  services: { systemMessage: undefined, toolPermissions: undefined },
}));

vi.mock("../i18n/index.js", () => ({
  t: (key: string) => key,
}));

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The executor needs a runnable model to emit started/reported/finished
// around; the failure path is what this suite exercises without one.
const runAgentTurn = vi.fn();
vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return { ...actual, getSessionActiveTeam: () => undefined };
});

describe("subagent lifecycle events on the agent event bus", () => {
  let events: AgentEvent[];

  beforeEach(() => {
    events = [];
    subscribeAgentEvents((event) => events.push(event));
  });

  afterEach(() => {
    resetAgentEventBus();
    runAgentTurn.mockReset();
  });

  const state = (name: string) =>
    ({
      model: { name },
      llmApi: {},
      assistant: {},
    }) as any;

  const parentContext = {
    id: "parent-1",
    parentContext: undefined,
    delegationDepth: 0,
    systemMessage: "",
    permissions: { policies: [] },
    mode: "default",
    abortSignal: new AbortController().signal,
  } as any;

  it("emits started, reported and finished around a successful run", async () => {
    runAgentTurn.mockImplementation(async ({ chatHistory }: any) => {
      chatHistory.push({
        message: { role: "assistant", content: "R1: PASS - tests ran" },
        contextItems: [],
      });
    });

    const result = await executeSubAgent({
      agent: state("tester"),
      prompt: "run the tests",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    expect(result.success).toBe(true);
    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "subagent.started",
      "subagent.reported",
      "subagent.finished",
    ]);
    expect(events[0]).toMatchObject({
      type: "subagent.started",
      agentName: "tester",
      prompt: "run the tests",
    });
    expect(events[1]).toMatchObject({
      type: "subagent.reported",
      agentName: "tester",
    });
    expect(events[2]).toMatchObject({
      type: "subagent.finished",
      agentName: "tester",
      success: true,
    });
    // Every event is stamped with the parent session identity.
    for (const event of events) {
      expect(event.sessionId).toBe("parent-1");
    }
  });

  it("emits finished with success false and the error when the run fails", async () => {
    runAgentTurn.mockRejectedValue(new Error("model offline"));

    const result = await executeSubAgent({
      agent: state("tester"),
      prompt: "run the tests",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    expect(result.success).toBe(false);
    const finished = events.find((event) => event.type === "subagent.finished");
    expect(finished).toMatchObject({
      type: "subagent.finished",
      agentName: "tester",
      success: false,
    });
  });

  it("creates the child at dispatch start and persists the failure there", async () => {
    runAgentTurn.mockRejectedValue(new Error("model offline"));

    await executeSubAgent({
      agent: state("tester"),
      prompt: "run the tests",
      parentSessionId: "parent-1",
      abortController: new AbortController(),
      parentContext,
    });

    const started = events.find(
      (event) => event.type === "subagent.started",
    ) as Extract<AgentEvent, { type: "subagent.started" }>;
    expect(started.childSessionId).toBeTruthy();

    const loaded = sessionStore.load(started.childSessionId!)?.session;
    expect(loaded).toMatchObject({
      parentSessionId: "parent-1",
      subagentType: "tester",
    });
    const last = loaded?.history.at(-1);
    expect(
      typeof last?.message.content === "string" ? last.message.content : "",
    ).toContain("Subagent execution failed: model offline");

    const finished = events.find((event) => event.type === "subagent.finished");
    expect(finished).toMatchObject({ success: false });
    expect(finished).not.toHaveProperty("cancelled");
  });

  it("reports an aborted run as cancelled and stores the cancellation notice", async () => {
    const controller = new AbortController();
    runAgentTurn.mockImplementation(async () => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const result = await executeSubAgent({
      agent: state("tester"),
      prompt: "run the tests",
      parentSessionId: "parent-1",
      abortController: controller,
      parentContext,
    });

    expect(result.success).toBe(false);
    const started = events.find(
      (event) => event.type === "subagent.started",
    ) as Extract<AgentEvent, { type: "subagent.started" }>;
    const finished = events.find((event) => event.type === "subagent.finished");
    expect(finished).toMatchObject({
      type: "subagent.finished",
      agentName: "tester",
      success: false,
      cancelled: true,
    });

    const loaded = sessionStore.load(started.childSessionId!)?.session;
    const last = loaded?.history.at(-1);
    expect(
      typeof last?.message.content === "string" ? last.message.content : "",
    ).toBe("Subagent execution was cancelled by the user.");
  });
});
