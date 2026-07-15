import type { ZCodeSessionEvent } from "@zcode/shared";
import {
  conversationDeltaSchema,
  conversationSnapshotSchema,
  pendingInteractionSchema,
  subagentRowSchema,
  workflowRunsStateSchema,
} from "@zcode/shared/zcode-protocol-v4";
import type { Session, TeamRunRecord, ToolCallState } from "core/index.js";
import { describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";

import type { GoalLifecycleState } from "./events.js";
import { deltasForEvent } from "./v4Deltas.js";
import {
  buildConversationSnapshot,
  createFrameSubscription,
  derivePendingInteractions,
} from "./v4Frames.js";

const session = {
  sessionId: "session-1",
  title: "Fixture",
  workspaceDirectory: "/workspace",
  history: [],
} as unknown as Session;

function permissionRequested(seq: number, requestId = "request-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "permission.requested",
    payload: {
      requestId,
      toolCallId: "tool-1",
      toolName: "bash",
      riskLevel: "medium",
      reason: "Run a shell command",
      input: { command: "ls" },
      options: [
        {
          optionId: "allow_once",
          kind: "allowOnce",
          name: "Allow once",
          response: { decision: "allow" },
        },
        {
          optionId: "deny",
          kind: "deny",
          name: "Deny",
          response: { decision: "deny" },
        },
      ],
    },
  } as unknown as ZCodeSessionEvent;
}

function permissionResolved(seq: number, requestId = "request-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "permission.resolved",
    payload: {
      requestId,
      toolCallId: "tool-1",
      decision: "allow",
    },
  } as unknown as ZCodeSessionEvent;
}

function userInputRequested(seq: number, requestId = "question-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "userInput.requested",
    payload: {
      requestId,
      prompt: "Which branch?",
      inputType: "choice",
      choices: ["main", "next"],
    },
  } as unknown as ZCodeSessionEvent;
}

function userInputResolved(seq: number, requestId = "question-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "userInput.resolved",
    payload: { requestId, cancelled: false, value: "main" },
  } as unknown as ZCodeSessionEvent;
}

describe("derivePendingInteractions", () => {
  it("keeps an unanswered permission request with its options", () => {
    const pending = derivePendingInteractions([permissionRequested(1)]);

    expect(pending).toHaveLength(1);
    const parsed = pendingInteractionSchema.parse(pending[0]);
    expect(parsed).toMatchObject({
      interactionId: "request-1",
      kind: "permission",
      anchorRowId: null,
      payload: {
        kind: "permission",
        toolCallId: "tool-1",
        toolName: "bash",
        summary: "Run a shell command",
        detail: { command: "ls" },
        options: [
          { optionId: "allow_once", label: "Allow once", kind: "allowOnce" },
          { optionId: "deny", label: "Deny", kind: "deny" },
        ],
      },
    });
  });

  it("drops a permission once its resolution event is retained", () => {
    expect(
      derivePendingInteractions([
        permissionRequested(1),
        permissionResolved(2),
      ]),
    ).toEqual([]);
  });

  it("projects an unanswered choice question", () => {
    const pending = derivePendingInteractions([userInputRequested(1)]);
    const parsed = pendingInteractionSchema.parse(pending[0]);

    expect(parsed).toMatchObject({
      interactionId: "question-1",
      kind: "userInput",
      anchorRowId: null,
      payload: {
        kind: "userInput",
        prompt: "Which branch?",
        freeText: false,
        options: [
          { optionId: "main", label: "main" },
          { optionId: "next", label: "next" },
        ],
      },
    });
  });

  it("projects an unanswered question set with its tabs", () => {
    const event = {
      ...userInputRequested(1),
      payload: {
        requestId: "question-1",
        prompt: "Q1. Which branch?\nQ2. Which tests?",
        inputType: "choice",
        choices: ["main", "next"],
        questions: [
          {
            question: "Which branch?",
            options: ["main", "next"],
            header: "Branch",
          },
          {
            question: "Which tests?",
            options: ["unit", "e2e"],
            multiSelect: true,
          },
        ],
      },
    } as unknown as ZCodeSessionEvent;
    const pending = derivePendingInteractions([event]);
    const parsed = pendingInteractionSchema.parse(pending[0]);

    expect(parsed).toMatchObject({
      kind: "userInput",
      payload: {
        kind: "userInput",
        questions: [
          {
            question: "Which branch?",
            header: "Branch",
            options: [
              { value: "main", label: "main" },
              { value: "next", label: "next" },
            ],
          },
          {
            question: "Which tests?",
            header: "Q2",
            options: [
              { value: "unit", label: "unit" },
              { value: "e2e", label: "e2e" },
            ],
            multiSelect: true,
          },
        ],
      },
    });
  });

  it("drops a question once it is answered", () => {
    expect(
      derivePendingInteractions([userInputRequested(1), userInputResolved(2)]),
    ).toEqual([]);
  });

  it("carries the advertised permission options into the live delta", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const event = {
      ...permissionRequested(1),
      payload: {
        requestId: "request-1",
        toolCallId: "tool-1",
        toolName: "bash",
        reason: "Run a shell command",
        input: { command: "ls" },
        options: [
          {
            optionId: "allow_once",
            kind: "allowOnce",
            name: "Allow once",
            response: { decision: "allow" },
          },
          {
            optionId: "fullAccess",
            kind: "custom",
            name: "Full access",
            response: { decision: "allow" },
          },
          {
            optionId: "deny",
            kind: "deny",
            name: "Deny",
            response: { decision: "deny" },
          },
        ],
      },
    } as unknown as ZCodeSessionEvent;
    const deltas = deltasForEvent(frame, event);

    expect(deltas).toHaveLength(1);
    const patch = (deltas[0] as { patch: { pendingInteractions: unknown[] } })
      .patch;
    expect(conversationDeltaSchema.parse(deltas[0]).op).toBe("state.updated");
    const parsed = pendingInteractionSchema.parse(patch.pendingInteractions[0]);
    expect(
      parsed.payload.kind === "permission"
        ? parsed.payload.options.map((option) => option.optionId)
        : [],
    ).toEqual(["allow_once", "fullAccess", "deny"]);
  });

  it("publishes the pending interactions on the conversation snapshot", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      { eventSeq: 2, stateRevision: 2 },
      false,
      derivePendingInteractions([permissionRequested(1)]),
    );

    expect(snapshot.pendingInteractions).toHaveLength(1);
    expect(snapshot.pendingInteractions[0]?.interactionId).toBe("request-1");
  });
});

describe("workflowRuns on the conversation snapshot", () => {
  const teamRun: TeamRunRecord = {
    runId: "team-1",
    team: "dev",
    goal: "Ship the feature",
    mode: "serial",
    startedAt: "2026-11-09T00:00:00.000Z",
    status: "completed",
    members: [
      { name: "implementer", status: "completed", model: "cheap-model" },
      { name: "tester", status: "completed", model: "work-model" },
    ],
  };

  it("projects the ledger with its workflow revision", () => {
    const withRuns = { ...session, teamRuns: [teamRun] } as unknown as Session;
    const frame = createFrameSubscription(withRuns, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      withRuns,
      frame,
      { eventSeq: 4, stateRevision: 4, workflowRevision: 4 },
      false,
    );

    expect(() =>
      workflowRunsStateSchema.parse(snapshot.workflowRuns),
    ).not.toThrow();
    expect(snapshot.workflowRuns).toMatchObject({
      revision: 4,
      runs: [
        {
          runId: "team-1",
          status: "completed",
          phaseNames: ["wave-1", "wave-2"],
          nodes: [
            { siteId: "step-1", phase: "settled", outcome: "ok" },
            { siteId: "step-2", phase: "settled", outcome: "ok" },
          ],
        },
      ],
    });
  });

  it("publishes an empty state when no team ran", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      { eventSeq: 0, stateRevision: 0, workflowRevision: 0 },
      false,
    );

    expect(snapshot.workflowRuns).toEqual({ revision: 0, runs: [] });
  });
});

describe("usage, goal and plan on the conversation snapshot", () => {
  const todoState: ToolCallState = {
    toolCallId: "todo-1",
    toolCall: {
      id: "todo-1",
      type: "function",
      function: {
        name: "Todo",
        arguments: '{"action":"add","text":"Write tests"}',
      },
    },
    status: "done",
    parsedArgs: { action: "add", text: "Write tests" },
    output: [
      {
        content: `Added todo #1\n\ntnt-todo:${JSON.stringify({
          action: "add",
          todos: [
            { id: 1, text: "Write tests", done: false },
            { id: 2, text: "Ship it", done: true },
          ],
          nextId: 3,
        })}`,
        name: "todo",
        description: "todo state",
      },
    ],
  };

  const goal: GoalLifecycleState = {
    targetId: "session-1:goal",
    objective: "Ship the feature",
    status: "verified",
    iteration: 2,
    timeUsedSeconds: 9,
    activeRunStartedAtMs: null,
    verifications: [
      {
        iteration: 2,
        outcome: "pass",
        at: 1_500,
        anchorRowId: null,
      },
    ],
    iterations: [],
    createdAt: 1_000,
    updatedAt: 2_000,
  };

  it("files usage from the session totals and the last request", () => {
    const usageSession = {
      ...session,
      usage: {
        promptTokens: 300,
        completionTokens: 40,
        totalCost: 0,
        promptTokensDetails: { cachedTokens: 150, cacheWriteTokens: 15 },
      },
      history: [
        { message: { role: "user", content: "hi" }, contextItems: [] },
        {
          message: {
            role: "assistant",
            content: "hello",
            usage: { promptTokens: 90, completionTokens: 10 },
          },
          contextItems: [],
        },
      ],
    } as unknown as Session;
    const frame = createFrameSubscription(usageSession, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      usageSession,
      frame,
      { eventSeq: 0, stateRevision: 0 },
      false,
    );

    expect(snapshot.usage.cumulative).toEqual({
      inputTokens: 300,
      outputTokens: 40,
      cacheReadTokens: 150,
      cacheWriteTokens: 15,
    });
    expect(snapshot.usage.contextWindow).toBeNull();
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("fills contextWindow when the active model's window is configured", () => {
    serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
      llmApi: null,
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        contextLength: 200_000,
      },
      assistant: null,
    } as never);
    const usageSession = {
      ...session,
      chatModelTitle: "anthropic/claude-sonnet-4-5",
      history: [
        {
          message: {
            role: "assistant",
            content: "hello",
            usage: { promptTokens: 70, completionTokens: 10 },
          },
          contextItems: [],
        },
      ],
    } as unknown as Session;
    const frame = createFrameSubscription(usageSession, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      usageSession,
      frame,
      { eventSeq: 0, stateRevision: 0 },
      false,
    );

    expect(snapshot.usage.contextWindow).toEqual({
      usedTokens: 70,
      maxTokens: 200_000,
      autoCompactThresholdTokens: null,
    });
  });

  it("projects an observed goal and the replayed todo plan", () => {
    const todoSession = {
      ...session,
      history: [
        { message: { role: "user", content: "start" }, contextItems: [] },
        {
          message: {
            role: "assistant",
            content: "planning",
            toolCalls: [
              {
                id: "todo-1",
                type: "function",
                function: {
                  name: "Todo",
                  arguments: '{"action":"add","text":"Write tests"}',
                },
              },
            ],
          },
          contextItems: [],
          toolCallStates: [todoState],
        },
      ],
    } as unknown as Session;
    const frame = createFrameSubscription(todoSession, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      todoSession,
      frame,
      { eventSeq: 0, stateRevision: 0, goal },
      false,
    );

    expect(snapshot.goal).toMatchObject({
      targetId: "session-1:goal",
      objective: "Ship the feature",
      status: "verified",
      iteration: 2,
      timeUsedSeconds: 9,
      verifications: [
        { iteration: 2, outcome: "pass", at: 1_500, anchorRowId: null },
      ],
      iterations: [],
    });
    expect(snapshot.plan).toEqual({
      items: [
        { id: "1", content: "Write tests", status: "pending" },
        { id: "2", content: "Ship it", status: "completed" },
      ],
      updatedAt: 0,
    });
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("leaves goal and plan null when nothing real exists", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      { eventSeq: 0, stateRevision: 0 },
      false,
    );

    expect(snapshot.goal).toBeNull();
    expect(snapshot.plan).toBeNull();
  });

  it("reports TNT's real reasoning depths on the session config", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      { eventSeq: 0, stateRevision: 0 },
      false,
    );

    expect(snapshot.config.thoughtLevels).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

function subagentEvent(
  seq: number,
  subagent: Record<string, unknown>,
): ZCodeSessionEvent {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "session.updated",
    payload: { sessionId: "session-1", subagent },
  } as unknown as ZCodeSessionEvent;
}

describe("subagent rows and projection", () => {
  const childSession = {
    sessionId: "child-1",
    history: [
      {
        message: {
          role: "assistant",
          content: "the report",
          toolCalls: [
            {
              id: "call-child-1",
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

  it("streams a started row then upserts it through reported and finished", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const started = deltasForEvent(
      frame,
      subagentEvent(1, {
        event: "started",
        id: "subagent-1",
        agentName: "code-reviewer",
        turnId: "turn-1",
        status: "running",
        summary: "Review the patch",
        startedAt: 1_000,
      }),
    );
    expect(started[0]).toMatchObject({
      op: "row.appended",
      row: {
        kind: "subagent",
        turnId: "turn-1",
        subagentType: "code-reviewer",
        status: "running",
        summaryText: "Review the patch",
      },
    });
    expect(started[1]).toMatchObject({
      op: "state.updated",
      patch: { subagents: { childSessionIds: [], running: [], endedTotal: 0 } },
    });

    const reported = deltasForEvent(
      frame,
      subagentEvent(2, {
        event: "reported",
        id: "subagent-1",
        agentName: "code-reviewer",
        turnId: "turn-1",
        status: "running",
        summary: "Found one regression",
        startedAt: 1_000,
      }),
    );
    expect(reported[0]).toMatchObject({
      op: "row.upserted",
      row: { summaryText: "Found one regression", status: "running" },
    });

    const finished = deltasForEvent(
      frame,
      subagentEvent(3, {
        event: "finished",
        id: "subagent-1",
        agentName: "code-reviewer",
        turnId: "turn-1",
        status: "success",
        summary: "Found one regression · 1 tool uses · 30 tokens",
        startedAt: 1_000,
        endedAt: 1_300,
        childSessionId: "child-1",
      }),
    );
    expect(finished[0]).toMatchObject({
      op: "row.upserted",
      row: {
        kind: "subagent",
        subagentType: "code-reviewer",
        status: "success",
        endedAt: 1_300,
        childSessionId: "child-1",
      },
    });
    expect(finished[1]).toMatchObject({
      op: "state.updated",
      patch: {
        subagents: {
          childSessionIds: ["child-1"],
          running: [],
          endedTotal: 1,
        },
      },
    });
    expect(finished[0]).toBeDefined();
    const rowDelta = finished[0] as { row?: unknown };
    expect(rowDelta.row).toBeDefined();
    expect(() => subagentRowSchema.parse(rowDelta.row)).not.toThrow();
    for (const delta of [...started, ...reported, ...finished]) {
      expect(() => conversationDeltaSchema.parse(delta)).not.toThrow();
    }
  });

  it("replays a row from a saved child session and measures its counters", () => {
    const toolState: ToolCallState = {
      toolCallId: "call-1",
      toolCall: {
        id: "call-1",
        type: "function",
        function: {
          name: "Subagent",
          arguments:
            '{"subagent_name":"code-reviewer","description":"Review the patch"}',
        },
      },
      status: "done",
      parsedArgs: {
        subagent_name: "code-reviewer",
        description: "Review the patch",
      },
      output: [
        { content: "the report", name: "report", description: "report" },
      ],
    };
    const parent = {
      sessionId: "session-replay",
      title: "Parent",
      workspaceDirectory: "/workspace",
      history: [
        { message: { role: "user", content: "start" }, contextItems: [] },
        {
          message: {
            role: "assistant",
            content: "delegating",
            toolCalls: [toolState.toolCall],
          },
          contextItems: [],
          toolCallStates: [toolState],
        },
      ],
    } as unknown as Session;

    const frame = createFrameSubscription(parent, "sub-1", "epoch-1", true, {
      childSessions: [
        {
          sessionId: "child-1",
          subagentType: "code-reviewer",
          dateCreated: "2026-11-09T00:00:00.000Z",
          updatedAt: "2026-11-09T00:00:05.000Z",
        },
      ],
      teamRuns: [],
      loadChildSession: () => childSession,
    });
    const row = frame.rows.find((candidate) => candidate.kind === "subagent");
    expect(row).toMatchObject({
      turnId: "session-replay:turn-1",
      subagentType: "code-reviewer",
      status: "success",
      childSessionId: "child-1",
    });
    expect(String(row?.summaryText)).toContain("the report");
    expect(String(row?.summaryText)).toContain("1 tool uses");
    expect(String(row?.summaryText)).toContain("30 tokens");
    expect(() => subagentRowSchema.parse(row)).not.toThrow();

    const snapshot = buildConversationSnapshot(
      parent,
      frame,
      { eventSeq: 1, stateRevision: 1 },
      false,
    );
    expect(snapshot.subagents).toMatchObject({
      childSessionIds: ["child-1"],
      running: [],
      endedTotal: 1,
    });
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("replays a team member from the ledger and keeps its run link", () => {
    const teamRun: TeamRunRecord = {
      runId: "team-1",
      team: "dev",
      goal: "Ship it",
      mode: "serial",
      startedAt: "2026-11-09T00:00:00.000Z",
      status: "completed",
      members: [
        {
          name: "implementer",
          status: "completed",
          subagentSessionId: "child-1",
          startedAt: "2026-11-09T00:00:01.000Z",
          finishedAt: "2026-11-09T00:00:04.000Z",
        },
      ],
    };
    const parent = {
      sessionId: "session-team",
      title: "Parent",
      workspaceDirectory: "/workspace",
      teamRuns: [teamRun],
      history: [
        {
          message: { role: "user", content: "run the team" },
          contextItems: [],
        },
        {
          message: {
            role: "assistant",
            content: "summoning",
            toolCalls: [
              {
                id: "call-team",
                type: "function",
                function: {
                  name: "SummonTeam",
                  arguments: '{"goal":"Ship it"}',
                },
              },
            ],
          },
          contextItems: [],
        },
      ],
    } as unknown as Session;

    const frame = createFrameSubscription(parent, "sub-1", "epoch-1", true, {
      childSessions: [],
      teamRuns: [teamRun],
      loadChildSession: () => childSession,
    });
    const row = frame.rows.find((candidate) => candidate.kind === "subagent");
    expect(row).toMatchObject({
      turnId: "session-team:turn-1",
      subagentType: "implementer",
      status: "success",
      childSessionId: "child-1",
    });
    expect(() => subagentRowSchema.parse(row)).not.toThrow();
  });

  it("omits counters when no child transcript exists", () => {
    const parent = {
      sessionId: "session-no-child",
      title: "Parent",
      workspaceDirectory: "/workspace",
      history: [
        { message: { role: "user", content: "start" }, contextItems: [] },
      ],
    } as unknown as Session;
    const frame = createFrameSubscription(parent, "sub-1", "epoch-1", true, {
      childSessions: [{ sessionId: "child-1", subagentType: "code-reviewer" }],
      teamRuns: [],
      loadChildSession: () => null,
    });
    const row = frame.rows.find((candidate) => candidate.kind === "subagent");
    expect(row).toBeDefined();
    expect(row?.summaryText).not.toContain("tool uses");
    expect(row?.summaryText).not.toContain("tokens");
  });

  it("projects a running subagent with the child session it now carries", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const started = deltasForEvent(
      frame,
      subagentEvent(1, {
        event: "started",
        id: "subagent-live",
        agentName: "code-reviewer",
        turnId: "turn-1",
        status: "running",
        summary: "Review the patch",
        startedAt: 1_000,
        childSessionId: "child-live",
      }),
    );

    expect(started[0]).toMatchObject({
      op: "row.appended",
      row: {
        kind: "subagent",
        status: "running",
        childSessionId: "child-live",
      },
    });
    expect(started[1]).toMatchObject({
      op: "state.updated",
      patch: {
        subagents: {
          childSessionIds: ["child-live"],
          running: [
            {
              childSessionId: "child-live",
              subagentType: "code-reviewer",
              title: "Review the patch",
              status: "running",
              startedAt: 1_000,
            },
          ],
          endedTotal: 0,
        },
      },
    });
    for (const delta of started) {
      expect(() => conversationDeltaSchema.parse(delta)).not.toThrow();
    }
  });

  it("replays a cancelled team member as a cancelled row", () => {
    const teamRun: TeamRunRecord = {
      runId: "team-cancelled",
      team: "dev",
      goal: "Ship it",
      mode: "serial",
      startedAt: "2026-11-09T00:00:00.000Z",
      status: "completed",
      members: [
        {
          name: "implementer",
          status: "cancelled",
          subagentSessionId: "child-1",
          startedAt: "2026-11-09T00:00:01.000Z",
          finishedAt: "2026-11-09T00:00:04.000Z",
        },
      ],
    };
    const parent = {
      sessionId: "session-cancelled",
      title: "Parent",
      workspaceDirectory: "/workspace",
      teamRuns: [teamRun],
      history: [
        {
          message: { role: "user", content: "run the team" },
          contextItems: [],
        },
      ],
    } as unknown as Session;

    const frame = createFrameSubscription(parent, "sub-1", "epoch-1", true, {
      childSessions: [],
      teamRuns: [teamRun],
      loadChildSession: () => childSession,
    });
    const row = frame.rows.find((candidate) => candidate.kind === "subagent");

    expect(row).toMatchObject({
      subagentType: "implementer",
      status: "cancelled",
      childSessionId: "child-1",
    });
    expect(() => subagentRowSchema.parse(row)).not.toThrow();
  });
});
