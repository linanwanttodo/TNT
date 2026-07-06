import { zcodeSessionEventSchema } from "@zcode/shared";
import type { Session, TeamRunRecord } from "core/index.js";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

import { createTranslationState, translateAgentEvent } from "./events.js";
import { SessionRuntimeStore } from "./runtime.js";
import type { SubagentSessionRef } from "./subagents.js";

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
      workflowRevision: 0,
      goal: null,
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

  it("carries the turn's usage into turn.completed", () => {
    const events = capturedEvents();
    const terminal = events.at(-1) as Extract<
      AgentEvent,
      { type: "turn.completed" }
    >;
    terminal.usage = {
      promptTokens: 120,
      completionTokens: 30,
      promptTokensDetails: { cachedTokens: 80, cacheWriteTokens: 10 },
      completionTokensDetails: { reasoningTokens: 5 },
    };

    const { translated } = translateAll(events);
    const completed = translated.at(-1);

    expect(completed?.payload).toMatchObject({
      tokenCount: 150,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedReadTokens: 80,
        cachedWriteTokens: 10,
        cacheWriteTokens: 10,
        reasoningTokens: 5,
      },
    });
    expect(() => zcodeSessionEventSchema.parse(completed)).not.toThrow();
  });

  it("derives a turn's usage from the session's cumulative growth", () => {
    let cumulative = {
      promptTokens: 100,
      completionTokens: 10,
      cachedTokens: 40,
      cacheWriteTokens: 5,
      reasoningTokens: 0,
    };
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => ({ ...cumulative }),
    });
    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 1_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 0,
      },
      state,
    );
    cumulative = { ...cumulative, promptTokens: 130, completionTokens: 25 };
    const completed = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 2,
        timestamp: 2_000,
        type: "turn.completed",
        content: "done",
      },
      state,
    );

    expect(completed.at(-1)?.payload).toMatchObject({
      tokenCount: 45,
      usage: {
        inputTokens: 30,
        outputTokens: 15,
        cachedReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it("leaves usage at zero when the turn's start was not observed", () => {
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => ({
        promptTokens: 500,
        completionTokens: 50,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      }),
    });
    const completed = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 2_000,
        type: "turn.completed",
        content: "done",
      },
      state,
    );

    expect(completed.at(-1)?.payload).toMatchObject({ tokenCount: 0 });
    expect(completed.at(-1)?.payload).not.toHaveProperty("usage");
  });

  it("derives the goal lifecycle from turns, stops and verifier verdicts", () => {
    let objective: string | null = "Ship the feature";
    const state = createTranslationState(sessionId, {
      readGoal: () => objective,
      readUsage: () => null,
    });
    const turnStarted = (seq: number, timestamp: number) =>
      translateAgentEvent(
        {
          sessionId,
          turnId,
          seq,
          timestamp,
          type: "turn.started",
          model: "test-model",
          historyLength: 0,
        },
        state,
      );
    const verdict = (seq: number, timestamp: number, value: string) =>
      translateAgentEvent(
        {
          sessionId,
          turnId,
          seq,
          timestamp,
          type: "subagent.finished",
          agentName: "tester",
          content: "report",
          success: true,
          verdict: value,
        },
        state,
      );

    turnStarted(1, 1_000);
    expect(state.goal).toMatchObject({
      objective: "Ship the feature",
      status: "active",
      iteration: 1,
      activeRunStartedAtMs: 1_000,
      verifications: [],
    });

    verdict(2, 1_500, "PASS");
    expect(state.goal).toMatchObject({
      status: "verified",
      verifications: [{ iteration: 1, outcome: "pass", at: 1_500 }],
    });

    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 3,
        timestamp: 2_000,
        type: "turn.completed",
        content: "done",
      },
      state,
    );
    expect(state.goal).toMatchObject({
      activeRunStartedAtMs: null,
      timeUsedSeconds: 1,
    });

    turnStarted(4, 3_000);
    expect(state.goal).toMatchObject({ status: "active", iteration: 2 });

    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 5,
        timestamp: 5_000,
        type: "turn.interrupted",
        reason: "user_abort",
      },
      state,
    );
    expect(state.goal).toMatchObject({
      status: "paused",
      activeRunStartedAtMs: null,
      timeUsedSeconds: 3,
    });

    verdict(6, 5_100, "PARTIAL");
    expect(state.goal?.status).toBe("notSatisfied");
    verdict(7, 5_200, "FAIL");
    expect(state.goal?.status).toBe("failed");
    expect(state.goal?.verifications.map((entry) => entry.outcome)).toEqual([
      "pass",
      "notSatisfied",
      "failed",
    ]);

    objective = null;
    turnStarted(8, 6_000);
    expect(state.goal).toBeNull();
  });

  it("translates started, reported and finished into session.updated rows", () => {
    const childSession = {
      sessionId: "child-1",
      history: [
        {
          message: {
            role: "assistant",
            content: "done",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
            usage: { promptTokens: 20, completionTokens: 10 },
          },
          contextItems: [],
        },
      ],
    } as unknown as Session;
    let children: SubagentSessionRef[] = [];
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => null,
      readChildSessions: () => children,
      loadChildSession: () => childSession,
    });
    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 1_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 0,
      },
      state,
    );
    const started = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "code-reviewer",
        prompt: "Review the patch\nLook for regressions",
      },
      state,
    );
    children = [{ sessionId: "child-1", subagentType: "code-reviewer" }];
    const reported = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 2,
        timestamp: 1_200,
        type: "subagent.reported",
        agentName: "code-reviewer",
        content: "Found one regression",
      },
      state,
    );
    const finished = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 3,
        timestamp: 1_300,
        type: "subagent.finished",
        agentName: "code-reviewer",
        content: "Found one regression",
        success: true,
        verdict: "FAIL",
      },
      state,
    );

    expect([started, reported, finished]).toHaveLength(3);
    const payloads = [started, reported, finished].map(
      (events) =>
        (events[0].payload as { subagent: Record<string, unknown> }).subagent,
    );
    expect(payloads.map((payload) => payload.event)).toEqual([
      "started",
      "reported",
      "finished",
    ]);
    expect(payloads[0]).toMatchObject({
      agentName: "code-reviewer",
      turnId,
      status: "running",
      summary: "Review the patch",
    });
    expect(payloads[1]).toMatchObject({
      status: "running",
      summary: "Found one regression",
    });
    expect(payloads[2]).toMatchObject({
      status: "success",
      childSessionId: "child-1",
      toolUses: 1,
      tokens: 30,
    });
    expect(String(payloads[2].summary)).toContain("1 tool uses");
    expect(String(payloads[2].summary)).toContain("30 tokens");
    expect(String(payloads[2].summary)).toContain("verdict: FAIL");
    for (const events of [started, reported, finished]) {
      expect(() => zcodeSessionEventSchema.parse(events[0])).not.toThrow();
    }
  });

  it("marks a failed subagent and omits counts that were never measured", () => {
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => null,
      readChildSessions: () => [],
    });
    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 1_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 0,
      },
      state,
    );
    translateAgentEvent(
      {
        sessionId,
        turnId: "tester",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "tester",
        prompt: "Test the change",
      },
      state,
    );
    const finished = translateAgentEvent(
      {
        sessionId,
        turnId: "tester",
        seq: 2,
        timestamp: 1_200,
        type: "subagent.finished",
        agentName: "tester",
        content: "build failed",
        success: false,
      },
      state,
    );
    const subagent = (
      finished[0].payload as { subagent: Record<string, unknown> }
    ).subagent;
    expect(subagent.status).toBe("failed");
    expect(subagent).not.toHaveProperty("childSessionId");
    expect(subagent).not.toHaveProperty("toolUses");
    expect(subagent).not.toHaveProperty("tokens");
    expect(String(subagent.summary)).not.toContain("tool uses");
    expect(String(subagent.summary)).not.toContain("tokens");
  });

  it("joins a dispatch to a team run only when the member match is unambiguous", () => {
    const run = (runId: string, withChild: boolean): TeamRunRecord => ({
      runId,
      team: "dev",
      goal: "Ship it",
      mode: "serial",
      startedAt: "2026-11-09T00:00:00.000Z",
      status: withChild ? "completed" : "running",
      members: [
        {
          name: "implementer",
          status: withChild ? "completed" : "running",
          ...(withChild ? { subagentSessionId: "child-9" } : {}),
        },
      ],
    });
    let runs: TeamRunRecord[] = [run("team-1", false)];
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => runs,
      readChildSessions: () => [],
    });
    translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 1_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 0,
      },
      state,
    );
    const started = translateAgentEvent(
      {
        sessionId,
        turnId: "implementer",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "implementer",
        prompt: "Write the feature",
      },
      state,
    );
    expect(
      (started[0].payload as { subagent: Record<string, unknown> }).subagent
        .runId,
    ).toBe("team-1");
    runs = [run("team-1", true)];
    const finished = translateAgentEvent(
      {
        sessionId,
        turnId: "implementer",
        seq: 2,
        timestamp: 1_200,
        type: "subagent.finished",
        agentName: "implementer",
        content: "done",
        success: true,
      },
      state,
    );
    expect(
      (finished[0].payload as { subagent: Record<string, unknown> }).subagent
        .childSessionId,
    ).toBe("child-9");

    const ambiguous = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => [run("team-1", false), run("team-2", false)],
      readChildSessions: () => [],
    });
    const ambiguousStart = translateAgentEvent(
      {
        sessionId,
        turnId: "implementer",
        seq: 1,
        timestamp: 2_100,
        type: "subagent.started",
        agentName: "implementer",
        prompt: "Write the feature",
      },
      ambiguous,
    );
    expect(
      (ambiguousStart[0].payload as { subagent: Record<string, unknown> })
        .subagent,
    ).not.toHaveProperty("runId");
  });
});
