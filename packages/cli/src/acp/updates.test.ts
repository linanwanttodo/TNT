import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

import {
  eventToUpdate,
  planUpdateFromTodoResult,
  planUpdateFromTodos,
  usageUpdate,
} from "./updates.js";

const base = {
  sessionId: "session-1",
  turnId: "turn-1",
  seq: 1,
  timestamp: 0,
};

const enabled = { notices: true, compaction: true };

describe("ACP updates", () => {
  it("maps answer and reasoning deltas to their distinct chunk types", () => {
    expect(
      eventToUpdate(
        { ...base, type: "content.delta", delta: "answer" },
        enabled,
      ),
    ).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer" },
    });
    expect(
      eventToUpdate(
        { ...base, type: "reasoning.delta", delta: "thought" },
        enabled,
      ),
    ).toMatchObject({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thought" },
    });
  });

  it("keeps the same toolCallId from started to finished", () => {
    const started = eventToUpdate(
      {
        ...base,
        type: "tool.started",
        toolName: "Read",
        toolCallId: "call-7",
        args: { filepath: "src/a.ts" },
      },
      enabled,
    );
    const finished = eventToUpdate(
      {
        ...base,
        seq: 3,
        type: "tool.finished",
        toolName: "Read",
        toolCallId: "call-7",
        status: "done",
        result: "file body",
      },
      enabled,
    );

    expect(started).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "call-7",
      kind: "read",
      status: "in_progress",
    });
    expect(finished).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-7",
      status: "completed",
    });
  });

  it("does not duplicate a tool call for intermediate status events", () => {
    expect(
      eventToUpdate(
        {
          ...base,
          type: "tool.updated",
          toolName: "Read",
          toolCallId: "call-7",
          status: "calling",
        },
        enabled,
      ),
    ).toBeNull();
  });

  it("turns a Todo result into a complete plan with done entries completed", () => {
    const todo = {
      action: "list",
      todos: [
        { id: 1, text: "ship it", done: true },
        { id: 2, text: "check it", done: false },
      ],
      nextId: 3,
    };

    expect(
      planUpdateFromTodoResult(
        `Added todo #1: ship it\n\ntnt-todo:${JSON.stringify(todo)}`,
      ),
    ).toEqual({
      sessionUpdate: "plan",
      entries: [
        { content: "ship it", priority: "medium", status: "completed" },
        { content: "check it", priority: "medium", status: "pending" },
      ],
    });
  });

  it("builds the same plan from replayed Todo entries", () => {
    expect(
      planUpdateFromTodos([
        { text: "ship it", done: true },
        { text: "check it", done: false },
      ]),
    ).toEqual({
      sessionUpdate: "plan",
      entries: [
        { content: "ship it", priority: "medium", status: "completed" },
        { content: "check it", priority: "medium", status: "pending" },
      ],
    });
  });

  it("clears the plan when the Todo list is empty", () => {
    expect(
      planUpdateFromTodoResult(
        `Cleared todos\n\ntnt-todo:${JSON.stringify({
          action: "clear",
          todos: [],
          nextId: 1,
        })}`,
      ),
    ).toEqual({ sessionUpdate: "plan", entries: [] });
  });

  it("ignores results that do not carry a Todo payload", () => {
    expect(planUpdateFromTodoResult("plain tool output")).toBeNull();
    expect(planUpdateFromTodoResult("tnt-todo:{not json")).toBeNull();
  });

  it("reports context usage with the session cost", () => {
    expect(usageUpdate(1200, 200_000, 0.04)).toEqual({
      sessionUpdate: "usage_update",
      used: 1200,
      size: 200_000,
      cost: { amount: 0.04, currency: "USD" },
    });
  });

  it("omits a zero cost but keeps the usage figures", () => {
    expect(usageUpdate(1200, 200_000, 0)).toEqual({
      sessionUpdate: "usage_update",
      used: 1200,
      size: 200_000,
    });
  });

  it("does not invent usage when the context or limit is unknown", () => {
    expect(usageUpdate(0, 200_000, 0.04)).toBeNull();
    expect(usageUpdate(1200, 0, 0.04)).toBeNull();
  });

  it("only sends notices and compaction updates the client advertised", () => {
    const notice = {
      ...base,
      type: "notice",
      message: "heads up",
    } satisfies AgentEvent;
    const compaction = {
      ...base,
      type: "compaction.started",
    } satisfies AgentEvent;

    expect(eventToUpdate(notice, enabled)).toMatchObject({
      sessionUpdate: "notice",
      title: "heads up",
    });
    expect(
      eventToUpdate(notice, { notices: false, compaction: true }),
    ).toBeNull();
    expect(eventToUpdate(compaction, enabled)).toMatchObject({
      sessionUpdate: "compaction_update",
      status: "in_progress",
    });
    expect(
      eventToUpdate(compaction, { notices: true, compaction: false }),
    ).toBeNull();
  });
});
