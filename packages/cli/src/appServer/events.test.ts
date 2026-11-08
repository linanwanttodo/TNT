import { zcodeSessionEventSchema } from "@zcode/shared";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

import { createTranslationState, translateAgentEvent } from "./events.js";
import { SessionRuntimeStore } from "./runtime.js";

const sessionId = "session-1";
const turnId = "turn-1";

function capturedEvents(): AgentEvent[] {
  return [
    {
      sessionId,
      turnId,
      seq: 1,
      timestamp: 1_000,
      type: "turn.started",
      model: "test-model",
      historyLength: 0,
    },
    {
      sessionId,
      turnId,
      seq: 2,
      timestamp: 1_010,
      type: "content.delta",
      delta: "Hello",
    },
    {
      sessionId,
      turnId,
      seq: 3,
      timestamp: 1_020,
      type: "tool.started",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
    },
    {
      sessionId,
      turnId,
      seq: 4,
      timestamp: 1_030,
      type: "tool.finished",
      toolCallId: "call-1",
      toolName: "bash",
      status: "done",
      result: "ok",
    },
    {
      sessionId,
      turnId,
      seq: 5,
      timestamp: 1_040,
      type: "turn.completed",
      content: "Hello",
    },
  ];
}

function translateAll(events: AgentEvent[]) {
  const state = createTranslationState(sessionId);
  const translated = events.flatMap((event) =>
    translateAgentEvent(event, state),
  );
  return { state, translated };
}

describe("translateAgentEvent", () => {
  it("maps a captured turn into ordered ZCode session events with one seq domain", () => {
    const { translated } = translateAll(capturedEvents());

    expect(translated.map((event) => event.type)).toEqual([
      "turn.started",
      "part.delta",
      "tool.updated",
      "tool.updated",
      "part.upserted",
      "turn.completed",
    ]);
    expect(translated.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(translated.map((event) => event.eventId)).size).toBe(
      translated.length,
    );
    for (const event of translated) {
      expect(() => zcodeSessionEventSchema.parse(event)).not.toThrow();
      expect(event.sessionId).toBe(sessionId);
      expect(event.turnId).toBe(turnId);
    }

    const started = translated[0];
    expect(started.payload).toMatchObject({
      turnNumber: 1,
      input: "",
      messageId: `${turnId}:assistant`,
    });
    expect(translated[1].payload).toMatchObject({
      field: "text",
      delta: "Hello",
    });
    expect(translated[2].payload).toMatchObject({
      kind: "started",
      toolCallId: "call-1",
      toolName: "bash",
    });
    expect(translated[3].payload).toMatchObject({
      kind: "result",
      toolCallId: "call-1",
    });
    expect(translated[4].payload).toMatchObject({
      part: { type: "text", text: "Hello" },
    });
    expect(translated[5].payload).toMatchObject({
      response: "Hello",
      toolCallCount: 1,
      resultType: "success",
    });
  });

  it("ends an interrupted turn with turn.completed resultType cancelled", () => {
    const events = capturedEvents().slice(0, 2);
    events.push({
      sessionId,
      turnId,
      seq: 3,
      timestamp: 1_100,
      type: "turn.interrupted",
      reason: "user_abort",
    });

    const { translated } = translateAll(events);

    expect(translated.map((event) => event.type)).toEqual([
      "turn.started",
      "part.delta",
      "part.upserted",
      "turn.completed",
    ]);
    expect(translated.at(-1)?.payload).toMatchObject({
      resultType: "cancelled",
      response: "Hello",
    });
    for (const event of translated) {
      expect(() => zcodeSessionEventSchema.parse(event)).not.toThrow();
    }
  });

  it("maps permission and quiz requests, and drops unknown events", () => {
    const state = createTranslationState(sessionId);
    const permission = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 2_000,
        type: "permission.requested",
        requestId: "perm-1",
        toolCallId: "call-1",
        toolName: "bash",
        toolArgs: { command: "rm -rf build" },
      },
      state,
    );
    const question = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 2,
        timestamp: 2_010,
        type: "question.requested",
        requestId: "quiz-1",
        question: "Which model?",
        options: ["a", "b"],
      },
      state,
    );
    const dropped = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 3,
        timestamp: 2_020,
        type: "queue.changed",
        length: 1,
      },
      state,
    );

    expect(permission).toHaveLength(1);
    expect(permission[0].type).toBe("permission.requested");
    expect(question).toHaveLength(1);
    expect(question[0].payload).toMatchObject({
      requestId: "quiz-1",
      prompt: "Which model?",
      inputType: "choice",
      choices: ["a", "b"],
    });
    expect(dropped).toEqual([]);
    for (const event of [...permission, ...question]) {
      expect(() => zcodeSessionEventSchema.parse(event)).not.toThrow();
    }
  });

  it("keeps the per-session seq and revision cursor monotonic in the store", () => {
    const runtimes = new SessionRuntimeStore();
    const events = capturedEvents().flatMap((event) =>
      runtimes.applyAgentEvent(event),
    );

    expect(runtimes.cursor(sessionId)).toEqual({
      eventSeq: 6,
      stateRevision: 6,
    });
    expect(
      runtimes.eventsAfter(sessionId, 3).map((event) => event.seq),
    ).toEqual([4, 5, 6]);

    const title = runtimes.append(sessionId, "session.titleUpdated", {
      previousTitle: "Untitled Session",
      title: "Renamed",
      source: "custom",
    });
    expect(title.seq).toBe(7);
    expect(runtimes.cursor(sessionId).stateRevision).toBe(7);
    expect(() => zcodeSessionEventSchema.parse(title)).not.toThrow();
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
