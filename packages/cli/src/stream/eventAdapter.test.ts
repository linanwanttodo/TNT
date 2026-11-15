import { describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

import { createAgentEventStream } from "./eventAdapter.js";

function stream() {
  const events: AgentEvent[] = [];
  const inner = {
    onContent: vi.fn(),
    onReasoning: vi.fn(),
    onToolStart: vi.fn(),
    onToolResult: vi.fn(),
    onToolError: vi.fn(),
    onToolPermissionRequest: vi.fn(),
    onSystemMessage: vi.fn(),
  };
  const adapter = createAgentEventStream({
    sessionId: "session-1",
    turnId: "turn-1",
    emit: (event) => events.push(event),
    now: () => 10,
  });
  const callbacks = adapter.callbacks(inner);
  return { events, inner, callbacks, adapter };
}

describe("agent event adapter", () => {
  it("maps answer and reasoning deltas to separate events", () => {
    const { events, inner, callbacks } = stream();

    callbacks.onContent!("hello");
    callbacks.onReasoning!("thinking");

    expect(events.map((event) => event.type)).toEqual([
      "content.delta",
      "reasoning.delta",
    ]);
    expect(events[0]).toMatchObject({
      delta: "hello",
      sessionId: "session-1",
      turnId: "turn-1",
      seq: 1,
    });
    expect(inner.onContent).toHaveBeenCalledWith("hello");
    expect(inner.onReasoning).toHaveBeenCalledWith("thinking");
  });

  it("maps the tool lifecycle without losing the legacy callbacks", () => {
    const { events, inner, callbacks } = stream();

    callbacks.onToolStart!("Read", { path: "a" }, "call-1");
    callbacks.onToolResult!("body", "Read", "done", "call-1");
    callbacks.onToolError!("boom", "Write");

    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.finished",
      "tool.finished",
    ]);
    expect(events[0]).toMatchObject({
      toolName: "Read",
      toolCallId: "call-1",
    });
    expect(events[1]).toMatchObject({
      status: "done",
      result: "body",
      toolCallId: "call-1",
    });
    expect(events[2]).toMatchObject({ status: "errored", result: "boom" });
    expect(inner.onToolResult).toHaveBeenCalledWith(
      "body",
      "Read",
      "done",
      "call-1",
    );
    expect(inner.onToolError).toHaveBeenCalledWith("boom", "Write");
  });

  it("maps a permission request and a notice", () => {
    const { events, callbacks } = stream();

    callbacks.onToolPermissionRequest!("Edit", { file: "a" }, "req-1");
    callbacks.onSystemMessage!("heads up");

    expect(events[0]).toMatchObject({
      type: "permission.requested",
      requestId: "req-1",
      toolName: "Edit",
    });
    expect(events[1]).toMatchObject({ type: "notice", message: "heads up" });
  });

  it("publishes controller-only events through the same sequence", () => {
    const { events, adapter } = stream();

    adapter.publish({ type: "turn.completed", content: "done" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "turn.completed", seq: 1 });
    expect(adapter.lastSeq()).toBe(1);
  });
});
