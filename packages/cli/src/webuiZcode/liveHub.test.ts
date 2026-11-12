import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeAgentEvents } from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";

import {
  liveHub,
  resetLiveHubForTesting,
  type LiveRuntime,
} from "./liveHub.js";

function runtime(overrides: Partial<LiveRuntime> = {}): LiveRuntime {
  return {
    runtimeId: "tui-test",
    handleUserMessage: vi.fn(),
    session: () => ({
      sessionId: "session-1",
      title: "live",
      workspaceDirectory: "/tmp",
    }),
    workingDir: () => "/tmp",
    providerInfo: () => ({ provider: "test", model: "model-a" }),
    runCommand: vi.fn(async () => "status output"),
    selectSession: vi.fn(),
    ...overrides,
  };
}

function captureEvents(): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = subscribeAgentEvents((event) => {
    events.push(event);
  });
  return { events, stop };
}

describe("liveHub", () => {
  beforeEach(() => resetLiveHubForTesting());
  afterEach(() => resetLiveHubForTesting());

  it("binds one runtime and replaces it on a second bind", () => {
    const first = runtime();
    const second = runtime({ runtimeId: "tui-second" });
    liveHub.bind(first);
    expect(liveHub.current()).toBe(first);
    liveHub.bind(second);
    expect(liveHub.current()).toBe(second);
    liveHub.unbind(first.runtimeId);
    expect(liveHub.current()).toBe(second);
    liveHub.unbind(second.runtimeId);
    expect(liveHub.isBound()).toBe(false);
  });

  it("hands ordinary browser text to the TUI turn", async () => {
    const rt = runtime();
    liveHub.bind(rt);
    expect(await liveHub.acceptRemoteText("请修复登录")).toEqual({
      kind: "sent",
    });
    expect(rt.handleUserMessage).toHaveBeenCalledWith("请修复登录");
    expect(rt.runCommand).not.toHaveBeenCalled();
  });

  it("runs a screen command on the TUI side instead of sending it to the model", async () => {
    const rt = runtime();
    const { events, stop } = captureEvents();
    liveHub.bind(rt);
    const outcome = await liveHub.acceptRemoteText("/status");
    stop();

    expect(outcome).toEqual({ kind: "command", output: "status output" });
    expect(rt.runCommand).toHaveBeenCalledWith("status", []);
    expect(rt.handleUserMessage).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "session.changed",
      "turn.started",
      "content.delta",
      "turn.completed",
    ]);
  });

  it("answers unbound when no TUI is attached", async () => {
    expect(await liveHub.acceptRemoteText("hi")).toEqual({ kind: "unbound" });
  });

  it("publishes the terminal's accepted input and the streamed answer", () => {
    const { events, stop } = captureEvents();
    liveHub.bind(runtime());
    liveHub.publishTurnStarted("本地打的字");
    liveHub.publishContent("回答");
    liveHub.publishTurnCompleted();
    stop();

    const turn = events.find((event) => event.type === "turn.started");
    expect(turn).toMatchObject({
      type: "turn.started",
      userInput: "本地打的字",
    });
    expect(events.map((event) => event.type)).toEqual([
      "session.changed",
      "turn.started",
      "content.delta",
      "turn.completed",
    ]);
  });

  it("asks for the session id on every event, so /clear is not shared as old", () => {
    let currentId = "before";
    const rt = runtime({
      session: () => ({
        sessionId: currentId,
        title: "live",
        workspaceDirectory: "/tmp",
      }),
    });
    const { events, stop } = captureEvents();
    liveHub.bind(rt);
    currentId = "after-clear";
    liveHub.publishTurnStarted("new session");
    stop();

    const bound = events.find((event) => event.type === "session.changed");
    const turn = events.find((event) => event.type === "turn.started");
    expect(bound?.sessionId).toBe("before");
    expect(turn?.sessionId).toBe("after-clear");
  });

  it("carries the turn ledger through the terminal event", () => {
    const { events, stop } = captureEvents();
    liveHub.bind(runtime());
    liveHub.publishTurnCompleted({
      usage: {
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 900,
        cost: 0.0042,
        rounds: 2,
      },
    });
    stop();
    const completed = events.find((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({
      type: "turn.completed",
      turnTotals: { inputTokens: 1200, outputTokens: 300, cost: 0.0042 },
    });
  });

  it("marks a session switch on the browser side", () => {
    const { events, stop } = captureEvents();
    liveHub.bind(runtime());
    liveHub.notifySessionChanged();
    stop();
    expect(
      events.filter((event) => event.type === "session.changed"),
    ).toHaveLength(2);
  });
});
