import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

import { eventToUpdate } from "./updates.js";

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
