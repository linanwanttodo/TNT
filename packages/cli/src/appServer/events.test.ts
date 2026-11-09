import { zcodeSessionEventSchema } from "@zcode/shared";
import {
  conversationSnapshotSchema,
  goalStateSchema,
  subagentRowSchema,
} from "@zcode/shared/zcode-protocol-v4";
import type {
  ChatHistoryItem,
  Session,
  SessionGoalState,
  TeamRunRecord,
  ToolCallState,
} from "core/index.js";
import { describe, expect, it } from "vitest";

import { t } from "../i18n/index.js";
import type { AgentEvent } from "../protocol/events.js";

import { createTranslationState, translateAgentEvent } from "./events.js";
import { SessionRuntimeStore } from "./runtime.js";
import { subagentRowFromWire, type SubagentSessionRef } from "./subagents.js";
import {
  buildConversationSnapshot,
  createFrameSubscription,
} from "./v4Frames.js";

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

  it("carries the turn's user input into the translated turn.started payload", () => {
    const state = createTranslationState(sessionId);
    const [started] = translateAgentEvent(
      {
        sessionId,
        turnId,
        seq: 1,
        timestamp: 1_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 1,
        userInput: "只回复数字 51",
      },
      state,
    ).filter((event) => event.type === "turn.started");

    expect(started?.payload).toMatchObject({ input: "只回复数字 51" });
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
    const storedOptions = (
      permission[0].payload as {
        options: {
          optionId: string;
          kind: string;
          name: string;
          response: unknown;
        }[];
      }
    ).options;
    expect(storedOptions.map((option) => option.optionId)).toContain(
      "fullAccess",
    );
    expect(
      storedOptions.find((option) => option.optionId === "fullAccess"),
    ).toMatchObject({
      kind: "custom",
      name: t("permission.fullAccess"),
      response: { decision: "allow" },
    });
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

function todoToolState(
  todos: Array<{ id: number; text: string; done: boolean }>,
): ToolCallState {
  return {
    toolCallId: "todo-1",
    toolCall: {
      id: "todo-1",
      type: "function",
      function: { name: "Todo", arguments: "{}" },
    },
    status: "done",
    parsedArgs: { action: "list" },
    output: [
      {
        content: `tnt-todo:${JSON.stringify({
          action: "list",
          todos,
          nextId: todos.length + 1,
        })}`,
        name: "todo",
        description: "todo state",
      },
    ],
  } as unknown as ToolCallState;
}

function fixtureSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId,
    title: "Fixture",
    workspaceDirectory: "/workspace",
    history: [],
    ...overrides,
  } as Session;
}

function subagentPayload(events: ReturnType<typeof translateAgentEvent>) {
  return (events[0].payload as { subagent: Record<string, unknown> }).subagent;
}

describe("goal lifecycle persistence and iterations", () => {
  const turnStarted = (seq: number, timestamp: number): AgentEvent => ({
    sessionId,
    turnId,
    seq,
    timestamp,
    type: "turn.started",
    model: "test-model",
    historyLength: 0,
  });

  const baseOptions = {
    readUsage: () => null,
    readTeamRuns: () => null,
    readChildSessions: () => [],
    loadChildSession: () => null,
  };

  it("seeds from the stored lifecycle instead of resetting to iteration 1", () => {
    const persisted: Array<SessionGoalState | null> = [];
    const stored = fixtureSession({
      goal: "Ship the feature",
      goalState: {
        objective: "Ship the feature",
        status: "paused",
        iteration: 3,
        timeUsedSeconds: 42,
        activeRunStartedAtMs: null,
        verifications: [
          { iteration: 2, outcome: "notSatisfied", at: 900, anchorRowId: null },
        ],
        iterations: [
          {
            iteration: 3,
            items: [{ id: "1", content: "Write tests", status: "pending" }],
            updatedAt: 950,
          },
        ],
        createdAt: 100,
        updatedAt: 1_000,
      },
    });
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () => stored,
      readGoal: () => "Ship the feature",
      persistGoalState: (_id, value) => persisted.push(value),
    });

    expect(state.goal).toMatchObject({
      targetId: `${sessionId}:goal`,
      status: "paused",
      iteration: 3,
      timeUsedSeconds: 42,
      verifications: [
        { iteration: 2, outcome: "notSatisfied", at: 900, anchorRowId: null },
      ],
      iterations: [{ iteration: 3, updatedAt: 950 }],
    });

    translateAgentEvent(turnStarted(1, 2_000), state);

    expect(state.goal).toMatchObject({
      status: "active",
      iteration: 4,
      timeUsedSeconds: 42,
      activeRunStartedAtMs: 2_000,
    });
    expect(persisted.at(-1)).toMatchObject({
      objective: "Ship the feature",
      status: "active",
      iteration: 4,
      timeUsedSeconds: 42,
    });
    expect(() => goalStateSchema.parse(persisted.at(-1))).not.toThrow();
  });

  it("records each iteration with the real Todo plan and its real timestamp", () => {
    const updatedIso = "2026-11-09T00:00:05.000Z";
    const todo = todoToolState([
      { id: 1, text: "Write tests", done: false },
      { id: 2, text: "Ship it", done: true },
    ]);
    const history = [
      {
        message: {
          role: "assistant",
          content: "planning",
          toolCalls: [todo.toolCall],
        },
        contextItems: [],
        toolCallStates: [todo],
        messageTimestamp: updatedIso,
      },
    ] as unknown as ChatHistoryItem[];
    const stored = fixtureSession({ goal: "Ship the feature", history });
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () => stored,
      readGoal: () => "Ship the feature",
      persistGoalState: () => {},
    });

    translateAgentEvent(turnStarted(1, 1_000), state);

    expect(state.goal?.iterations).toEqual([
      {
        iteration: 1,
        items: [
          { id: "1", content: "Write tests", status: "pending" },
          { id: "2", content: "Ship it", status: "completed" },
        ],
        updatedAt: Date.parse(updatedIso),
      },
    ]);
  });

  it("records an empty plan when the Todo list is real but empty", () => {
    const updatedIso = "2026-11-09T00:00:06.000Z";
    const todo = todoToolState([]);
    const history = [
      {
        message: { role: "assistant", content: "cleared" },
        contextItems: [],
        toolCallStates: [todo],
        messageTimestamp: updatedIso,
      },
    ] as unknown as ChatHistoryItem[];
    const stored = fixtureSession({ goal: "Ship the feature", history });
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () => stored,
      readGoal: () => "Ship the feature",
      persistGoalState: () => {},
    });

    translateAgentEvent(turnStarted(1, 1_000), state);

    expect(state.goal?.iterations).toEqual([
      { iteration: 1, items: [], updatedAt: Date.parse(updatedIso) },
    ]);
  });

  it("never synthesizes plan items when the history carries none", () => {
    const stored = fixtureSession({ goal: "Ship the feature" });
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () => stored,
      readGoal: () => "Ship the feature",
      persistGoalState: () => {},
    });

    translateAgentEvent(turnStarted(1, 1_000), state);

    expect(state.goal?.iterations).toEqual([
      { iteration: 1, items: [], updatedAt: 0 },
    ]);
  });

  it("clears the stored lifecycle when the goal is cleared", () => {
    let objective: string | null = "Ship the feature";
    const persisted: Array<SessionGoalState | null> = [];
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () =>
        fixtureSession({ goal: "Ship the feature", history: [] }),
      readGoal: () => objective,
      persistGoalState: (_id, value) => persisted.push(value),
    });

    translateAgentEvent(turnStarted(1, 1_000), state);
    expect(state.goal).not.toBeNull();

    objective = null;
    translateAgentEvent(turnStarted(2, 2_000), state);

    expect(state.goal).toBeNull();
    expect(persisted.at(-1)).toBeNull();
  });

  it("starts a fresh lifecycle at iteration 1 when the goal text changes", () => {
    let objective = "Ship feature A";
    const persisted: Array<SessionGoalState | null> = [];
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () =>
        fixtureSession({ goal: "Ship feature A", history: [] }),
      readGoal: () => objective,
      persistGoalState: (_id, value) => persisted.push(value),
    });

    translateAgentEvent(turnStarted(1, 1_000), state);
    translateAgentEvent(turnStarted(2, 2_000), state);
    expect(state.goal?.iteration).toBe(2);

    objective = "Ship feature B";
    translateAgentEvent(turnStarted(3, 3_000), state);

    expect(state.goal).toMatchObject({
      objective: "Ship feature B",
      iteration: 1,
      iterations: [{ iteration: 1 }],
    });
    expect(
      state.goal?.iterations.map((iteration) => iteration.iteration),
    ).toEqual([1]);
    expect(persisted.at(-1)).toMatchObject({
      objective: "Ship feature B",
      iteration: 1,
    });
  });

  it("projects the reloaded lifecycle into a snapshot the schema accepts", () => {
    const stored = fixtureSession({
      goal: "Ship the feature",
      goalState: {
        objective: "Ship the feature",
        status: "verified",
        iteration: 2,
        timeUsedSeconds: 9,
        activeRunStartedAtMs: null,
        verifications: [
          { iteration: 2, outcome: "pass", at: 1_500, anchorRowId: null },
        ],
        iterations: [
          {
            iteration: 2,
            items: [{ id: "1", content: "Write tests", status: "completed" }],
            updatedAt: 1_400,
          },
        ],
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    });
    const state = createTranslationState(sessionId, {
      ...baseOptions,
      readStoredSession: () => stored,
      readGoal: () => "Ship the feature",
      persistGoalState: () => {},
    });
    const frame = createFrameSubscription(stored, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      stored,
      frame,
      { eventSeq: 0, stateRevision: 0, goal: state.goal },
      false,
    );

    expect(snapshot.goal).toMatchObject({
      targetId: `${sessionId}:goal`,
      iteration: 2,
      iterations: [
        {
          iteration: 2,
          items: [{ id: "1", content: "Write tests", status: "completed" }],
          updatedAt: 1_400,
        },
      ],
    });
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

describe("subagent live rows, child transcripts and cancellation", () => {
  const turnStarted = (seq: number, timestamp: number): AgentEvent => ({
    sessionId,
    turnId,
    seq,
    timestamp,
    type: "turn.started",
    model: "test-model",
    historyLength: 0,
  });

  function childWithWork(): Session {
    return {
      sessionId: "child-1",
      history: [
        {
          message: {
            role: "assistant",
            content: "working",
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
  }

  function stateWithChild(loadChild: (id: string) => Session | null) {
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => null,
      readChildSessions: () => [],
      loadChildSession: loadChild,
      persistGoalState: () => {},
    });
    translateAgentEvent(turnStarted(1, 1_000), state);
    return state;
  }

  it("carries the child session and live counts on a started row", () => {
    const state = stateWithChild((id) =>
      id === "child-1" ? childWithWork() : null,
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
        childSessionId: "child-1",
      },
      state,
    );
    const subagent = subagentPayload(started);

    expect(subagent).toMatchObject({
      event: "started",
      status: "running",
      childSessionId: "child-1",
      toolUses: 1,
      tokens: 30,
    });
    expect(String(subagent.summary)).toContain("1 tool uses");

    const row = subagentRowFromWire(subagent, 1, turnId);
    expect(row).toMatchObject({
      kind: "subagent",
      status: "running",
      childSessionId: "child-1",
    });
    expect(() => subagentRowSchema.parse(row)).not.toThrow();
  });

  it("does not invent counts when the child transcript is unreadable", () => {
    const state = stateWithChild(() => null);
    const started = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "code-reviewer",
        prompt: "Review the patch",
        childSessionId: "child-missing",
      },
      state,
    );
    const subagent = subagentPayload(started);

    expect(subagent).toHaveProperty("childSessionId", "child-missing");
    expect(subagent).not.toHaveProperty("toolUses");
    expect(subagent).not.toHaveProperty("tokens");
    expect(String(subagent.summary)).not.toContain("tool uses");
  });

  it("marks an aborted run cancelled rather than failed", () => {
    const state = stateWithChild((id) =>
      id === "child-1" ? childWithWork() : null,
    );
    translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "code-reviewer",
        prompt: "Review the patch",
        childSessionId: "child-1",
      },
      state,
    );
    const finished = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 2,
        timestamp: 1_200,
        type: "subagent.finished",
        agentName: "code-reviewer",
        content: "Subagent execution was cancelled by the user.",
        success: false,
        cancelled: true,
      },
      state,
    );
    const subagent = subagentPayload(finished);

    expect(subagent.status).toBe("cancelled");
    const row = subagentRowFromWire(subagent, 1, turnId);
    expect(row?.status).toBe("cancelled");
    expect(() => subagentRowSchema.parse(row)).not.toThrow();
  });

  it("keeps replay working for old starts that carried no child id", () => {
    let children: SubagentSessionRef[] = [];
    const state = createTranslationState(sessionId, {
      readGoal: () => null,
      readUsage: () => null,
      readTeamRuns: () => null,
      readChildSessions: () => children,
      loadChildSession: () => childWithWork(),
      persistGoalState: () => {},
    });
    translateAgentEvent(turnStarted(1, 1_000), state);
    const started = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 1,
        timestamp: 1_100,
        type: "subagent.started",
        agentName: "code-reviewer",
        prompt: "Review the patch",
      },
      state,
    );
    expect(subagentPayload(started)).not.toHaveProperty("childSessionId");

    children = [{ sessionId: "child-1", subagentType: "code-reviewer" }];
    const finished = translateAgentEvent(
      {
        sessionId,
        turnId: "code-reviewer",
        seq: 2,
        timestamp: 1_200,
        type: "subagent.finished",
        agentName: "code-reviewer",
        content: "done",
        success: true,
      },
      state,
    );
    expect(subagentPayload(finished)).toMatchObject({
      status: "success",
      childSessionId: "child-1",
      toolUses: 1,
      tokens: 30,
    });
  });
});
