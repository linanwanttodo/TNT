import type { ZCodeSessionEvent } from "@zcode/shared";
import {
  conversationSnapshotSchema,
  pendingInteractionSchema,
  workflowRunsStateSchema,
} from "@zcode/shared/zcode-protocol-v4";
import type { Session, TeamRunRecord, ToolCallState } from "core/index.js";
import { describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";

import type { GoalLifecycleState } from "./events.js";
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

  it("drops a question once it is answered", () => {
    expect(
      derivePendingInteractions([userInputRequested(1), userInputResolved(2)]),
    ).toEqual([]);
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
});
