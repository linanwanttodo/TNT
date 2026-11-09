/* eslint-disable max-lines -- the row, snapshot and projection builders share one frame model */
import type { ZCodeSessionEvent } from "@zcode/shared";
import type {
  ConversationRow,
  ConversationSnapshot,
  ConversationTopicFrame,
  ConversationTopicWireFrame,
  GoalState,
  PendingInteraction,
  PlanState,
  SubagentRow,
  ToolCallRow,
} from "@zcode/shared/zcode-protocol-v4";
import {
  clampWorkflowRunsForLegacy,
  V4_WIRE_PROTOCOL_VERSION,
} from "@zcode/shared/zcode-protocol-v4";
import type { Session, TeamRunRecord } from "core/index.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";

import type { GoalLifecycleState } from "./events.js";
import { questionSetFrom, zcodeQuestions } from "./interactionPayload.js";
import {
  contextWindowForSession,
  lastPromptTokens,
  sessionTodoList,
  sessionTodoUpdatedAt,
  toZcodeMessages,
} from "./snapshot.js";
import {
  listChildSessions,
  readTeamRuns,
  replayedSubagents,
  SUBAGENT_TOOL_NAMES,
  subagentProjectionFromRows,
  type ReplaySubagentCall,
  type ReplaySubagentToolCall,
  type SubagentSessionRef,
} from "./subagents.js";
import {
  activeTeamRun,
  teamRunsToWorkflowRuns,
  teamRunWorkflowDisplay,
} from "./workflowRuns.js";

export interface FrameSubscription {
  subscriptionId: string;
  sessionId: string;
  topic: string;
  logEpoch: string;
  frameOrdinal: number;
  lastFrameSeq: number;
  nextRowId: number;
  rows: ConversationRow[];
  turnId: string;
  turnNumber: number;
  text: string;
  reasoning: string;
  textRowId: number | null;
  reasoningRowId: number | null;
  turnHeaderRowId: number | null;
  turnHeaderState:
    "running" | "completedSuccess" | "completedInterrupted" | "failed";
  turnStartedAt: number;
  readonly toolRows: Map<string, ToolCallRow>;
  /** Live subagent rows keyed by the lifecycle id carried on the wire event. */
  readonly subagentRows: Map<string, SubagentRow>;
  /** Whether this subscriber asked for `workflowRun.*` key-level deltas. */
  readonly workflowRunDeltas: boolean;
}

export interface FrameSubscriptionOptions {
  childSessions?: readonly SubagentSessionRef[];
  teamRuns?: readonly TeamRunRecord[];
  loadChildSession?: (sessionId: string) => Session | null;
}

function modelParts(title: string | undefined): {
  provider: string;
  model: string;
} {
  if (!title) {
    return { provider: "tnt", model: "unknown" };
  }
  const slash = title.indexOf("/");
  if (slash <= 0 || slash === title.length - 1) {
    return { provider: "tnt", model: "unknown" };
  }
  return { provider: title.slice(0, slash), model: title.slice(slash + 1) };
}

export function turnBase(frame: FrameSubscription, rowId: number) {
  return {
    rowId,
    turnId: frame.turnId,
    createdAt: 0,
    createdAtSeq: 0,
  };
}

function toolStatusOf(state: string): ToolCallRow["status"] {
  if (state === "running") {
    return "running";
  }
  if (state === "completed") {
    return "success";
  }
  if (state === "error") {
    return "error";
  }
  return "pendingApproval";
}

function rowsFromSession(
  session: Session,
  options: FrameSubscriptionOptions,
): ConversationRow[] {
  const rows: ConversationRow[] = [];
  const summonTeamCalls: ReplaySubagentCall[] = [];
  const subagentCalls: ReplaySubagentToolCall[] = [];
  let rowId = 0;
  let turnNumber = 0;
  let turnId = `${session.sessionId}:turn-1`;
  for (const message of toZcodeMessages(session)) {
    if (message.info.role === "user") {
      turnNumber += 1;
      turnId = `${session.sessionId}:turn-${turnNumber}`;
      rowId += 1;
      rows.push({
        rowId,
        turnId,
        createdAt: 0,
        createdAtSeq: 0,
        kind: "turnHeader",
        origin: "userInput",
        state: "completedSuccess",
        startedAt: 0,
      });
    }
    for (const part of message.parts) {
      rowId += 1;
      const base = { rowId, turnId, createdAt: 0, createdAtSeq: 0 };
      if (message.info.role === "user" && part.type === "text") {
        rows.push({
          ...base,
          kind: "userInput",
          origin: message.info.synthetic ? "synthetic" : "realUser",
          text: part.text,
        });
        continue;
      }
      if (part.type === "text") {
        rows.push({
          ...base,
          kind: "assistantText",
          text: part.text,
          state: "complete",
        });
      } else if (part.type === "reasoning") {
        rows.push({
          ...base,
          kind: "reasoning",
          text: part.text,
          state: "complete",
        });
      } else if (part.type === "tool") {
        collectToolCall(part, turnId, summonTeamCalls, subagentCalls);
        const status = toolStatusOf(part.state.status);
        const run =
          part.tool === "SummonTeam"
            ? activeTeamRun(session.teamRuns)
            : undefined;
        rows.push({
          ...base,
          kind: "toolCall",
          toolCallId: part.callId,
          toolName: part.tool,
          status,
          inputText: JSON.stringify(part.state.input ?? {}),
          ...(run
            ? {
                display: teamRunWorkflowDisplay(
                  run,
                  part.state.status !== "error",
                ),
              }
            : {}),
          ...(part.state.status === "completed"
            ? { output: { text: part.state.output } }
            : {}),
          ...(part.state.status === "error"
            ? { error: { code: "tool_error", message: part.state.error } }
            : {}),
        });
      }
    }
  }

  const replayed = replayedSubagents({
    childSessions:
      options.childSessions ?? listChildSessions(session.sessionId),
    teamRuns:
      options.teamRuns ??
      readTeamRuns(session.sessionId) ??
      session.teamRuns ??
      [],
    summonTeamCalls,
    subagentCalls,
    fallbackTurnId: `${session.sessionId}:delegated`,
    ...(options.loadChildSession
      ? { loadChildSession: options.loadChildSession }
      : {}),
  });
  for (const entry of replayed) {
    rowId += 1;
    rows.push({
      rowId,
      turnId: entry.turnId,
      createdAt: 0,
      createdAtSeq: 0,
      kind: "subagent",
      subagentType: entry.agentName,
      status: entry.status,
      summaryText: entry.summaryText,
      ...(entry.childSessionId ? { childSessionId: entry.childSessionId } : {}),
      ...(entry.startedAt === undefined ? {} : { startedAt: entry.startedAt }),
      ...(entry.endedAt === undefined ? {} : { endedAt: entry.endedAt }),
    });
  }
  return rows;
}

interface ToolPartForReplay {
  tool: string;
  state: { input: unknown };
}

function collectToolCall(
  part: ToolPartForReplay,
  turnId: string,
  summonTeamCalls: ReplaySubagentCall[],
  subagentCalls: ReplaySubagentToolCall[],
): void {
  const input = asRecord(part.state.input);
  if (part.tool === "SummonTeam") {
    const goal = typeof input.goal === "string" ? input.goal : undefined;
    const members = Array.isArray(input.members)
      ? input.members.filter(
          (member): member is string => typeof member === "string",
        )
      : undefined;
    summonTeamCalls.push({
      turnId,
      ...(goal === undefined ? {} : { goal }),
      ...(members === undefined ? {} : { members }),
    });
  }
  if (SUBAGENT_TOOL_NAMES.has(part.tool)) {
    const type =
      typeof input.subagent_name === "string" ? input.subagent_name : undefined;
    if (type) {
      subagentCalls.push({ turnId, type });
    }
  }
}

export function createFrameSubscription(
  session: Session,
  subscriptionId: string,
  logEpoch: string,
  workflowRunDeltas = true,
  options: FrameSubscriptionOptions = {},
): FrameSubscription {
  const rows = rowsFromSession(session, options);
  const turnNumber = rows.filter((row) => row.kind === "turnHeader").length;
  return {
    subscriptionId,
    sessionId: session.sessionId,
    topic: `conversation/${session.sessionId}`,
    logEpoch,
    frameOrdinal: 0,
    lastFrameSeq: 0,
    nextRowId: rows.length,
    rows,
    turnId: `${session.sessionId}:turn-${Math.max(1, turnNumber)}`,
    turnNumber: Math.max(1, turnNumber),
    text: "",
    reasoning: "",
    textRowId: null,
    reasoningRowId: null,
    turnHeaderRowId: null,
    turnHeaderState: "completedSuccess",
    turnStartedAt: 0,
    toolRows: new Map(),
    subagentRows: new Map(),
    workflowRunDeltas,
  };
}

export function controlState(running: boolean, startedAt: number) {
  return {
    phase: running ? ("running" as const) : ("completedSuccess" as const),
    sessionEnded: !running,
    canStop: running,
    stopState: running ? ("stoppable" as const) : ("idle" as const),
    stopTargetKind: "unknown" as const,
    activeWorks: running ? [{ kind: "primaryTurn" as const, startedAt }] : [],
    lastError: null,
    apiRetry: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

type PermissionOption = PendingInteraction["payload"] & {
  kind: "permission";
};

function permissionOption(
  value: unknown,
): PermissionOption["options"][number] | null {
  const record = asRecord(value);
  const optionId = stringField(record, "optionId");
  if (!optionId) {
    return null;
  }
  const kind =
    record.kind === "allowOnce" ||
    record.kind === "allowAlways" ||
    record.kind === "deny" ||
    record.kind === "custom"
      ? record.kind
      : "custom";
  const label =
    stringField(record, "label") ?? stringField(record, "name") ?? optionId;
  const response = asRecord(record.response);
  return {
    optionId,
    label,
    kind,
    ...(Object.keys(response).length > 0
      ? {
          response: response as PermissionOption["options"][number]["response"],
        }
      : {}),
  };
}

/**
 * Projects the retained permission and question events into the snapshot's
 * `pendingInteractions`. A request is pending until a matching `.resolved`
 * event appears; without this the snapshot could never show a blocking prompt
 * to a client that subscribes after the prompt was raised.
 */
export function derivePendingInteractions(
  events: readonly ZCodeSessionEvent[],
  rows: readonly ConversationRow[] = [],
): PendingInteraction[] {
  const rowIdForToolCall = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === "toolCall") {
      rowIdForToolCall.set(row.toolCallId, row.rowId);
    }
  }

  const pending = new Map<
    string,
    { order: number; interaction: PendingInteraction }
  >();
  events.forEach((event, order) => {
    const payload = asRecord(
      "payload" in event ? (event as { payload?: unknown }).payload : null,
    );
    const requestId = stringField(payload, "requestId");
    if (event.type === "permission.requested") {
      const toolCallId = stringField(payload, "toolCallId");
      if (!toolCallId) {
        return;
      }
      const toolName = stringField(payload, "toolName") ?? "tool";
      const options = Array.isArray(payload.options)
        ? payload.options
            .map(permissionOption)
            .filter(
              (
                option,
              ): option is NonNullable<PermissionOption["options"][number]> =>
                option !== null,
            )
        : [];
      const interactionId = requestId ?? toolCallId;
      const reason = stringField(payload, "reason");
      pending.set(interactionId, {
        order,
        interaction: {
          interactionId,
          kind: "permission",
          anchorRowId: rowIdForToolCall.get(toolCallId) ?? null,
          createdAt: event.timestamp,
          payload: {
            kind: "permission",
            toolCallId,
            toolName,
            summary:
              reason && reason.length > 0
                ? reason
                : `${toolName} requires permission`,
            detail: payload.input ?? null,
            options,
          },
        },
      });
      return;
    }
    if (event.type === "permission.resolved") {
      if (requestId) {
        pending.delete(requestId);
      }
      const toolCallId = stringField(payload, "toolCallId");
      if (toolCallId) {
        pending.delete(toolCallId);
      }
      return;
    }
    if (event.type === "userInput.requested") {
      if (!requestId) {
        return;
      }
      const choices = Array.isArray(payload.choices)
        ? payload.choices.filter(
            (choice): choice is string => typeof choice === "string",
          )
        : [];
      const questionSet = questionSetFrom(payload);
      const questions = questionSet ? zcodeQuestions(questionSet) : undefined;
      pending.set(requestId, {
        order,
        interaction: {
          interactionId: requestId,
          kind: "userInput",
          anchorRowId: null,
          createdAt: event.timestamp,
          payload: {
            kind: "userInput",
            prompt: stringField(payload, "prompt") ?? "",
            freeText: payload.inputType !== "choice" || choices.length === 0,
            ...(choices.length > 0
              ? {
                  options: choices.map((choice) => ({
                    optionId: choice,
                    label: choice,
                  })),
                }
              : {}),
            ...(questions ? { questions } : {}),
          },
        },
      });
      return;
    }
    if (event.type === "userInput.resolved" && requestId) {
      pending.delete(requestId);
    }
  });

  return [...pending.values()]
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.interaction);
}

function goalStateOf(goal: GoalLifecycleState): GoalState {
  return {
    targetId: goal.targetId,
    objective: goal.objective,
    summaryTitle: null,
    status: goal.status,
    iteration: goal.iteration,
    timeUsedSeconds: goal.timeUsedSeconds,
    activeRunStartedAtMs: goal.activeRunStartedAtMs,
    verifications: goal.verifications.map((verification) => ({
      iteration: verification.iteration,
      outcome: verification.outcome,
      at: verification.at,
      anchorRowId: verification.anchorRowId,
      ...(verification.reason ? { reason: verification.reason } : {}),
    })),
    // TNT has no goal-iteration step detail; an empty list is the honest shape.
    iterations: [],
  };
}

function planStateOf(session: Session): PlanState | null {
  const todos = sessionTodoList(session);
  if (todos.length === 0) {
    return null;
  }
  return {
    items: todos.map((todo) => ({
      id: String(todo.id),
      content: todo.text,
      status: todo.done ? "completed" : "pending",
    })),
    updatedAt: sessionTodoUpdatedAt(session),
  };
}

function cumulativeUsage(session: Session) {
  return {
    inputTokens: session.usage?.promptTokens ?? 0,
    outputTokens: session.usage?.completionTokens ?? 0,
    cacheReadTokens: session.usage?.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: session.usage?.promptTokensDetails?.cacheWriteTokens ?? 0,
  };
}

export function buildConversationSnapshot(
  session: Session,
  frame: FrameSubscription,
  cursor: {
    eventSeq: number;
    stateRevision: number;
    workflowRevision?: number;
    goal?: GoalLifecycleState | null;
  },
  running: boolean,
  pendingInteractions: PendingInteraction[] = [],
): ConversationSnapshot {
  const { provider, model } = modelParts(session.chatModelTitle ?? undefined);
  const rows = [...frame.rows].sort((left, right) => left.rowId - right.rowId);
  const contextWindow = contextWindowForSession(session);
  const goal = cursor.goal ? goalStateOf(cursor.goal) : null;
  const subagents = subagentProjectionFromRows(rows, cursor.eventSeq);
  const workflowRuns = teamRunsToWorkflowRuns(
    session.teamRuns ?? [],
    cursor.workflowRevision ?? 0,
  );
  return {
    protocolVersion: 1,
    sessionId: session.sessionId,
    logEpoch: frame.logEpoch,
    seq: cursor.eventSeq,
    revision: cursor.stateRevision,
    control: controlState(running, frame.turnStartedAt || Date.now()),
    availability: {
      fork: { allowed: false, reasonCode: "appServer.unavailable" },
      compact: running
        ? { allowed: false, reasonCode: "appServer.busy" }
        : { allowed: true },
      switchModelConfig: {
        allowed: false,
        reasonCode: "appServer.unavailable",
      },
      setFollowupMode: { allowed: false, reasonCode: "appServer.unavailable" },
      queueEdit: { allowed: false, reasonCode: "appServer.unavailable" },
      sendQueuedNow: { allowed: false, reasonCode: "appServer.unavailable" },
      pauseGoal: { allowed: false, reasonCode: "appServer.unavailable" },
      resumeGoal: { allowed: false, reasonCode: "appServer.unavailable" },
    },
    inputRouting: { mode: "startNow" },
    meta: {
      title: session.title,
      titleSource:
        session.title === DEFAULT_SESSION_TITLE ? "default" : "custom",
    },
    config: {
      provider,
      model,
      thought: "off",
      thoughtLevels: [],
      followupMode: "queue",
      mode: session.mode ?? "build",
    },
    modelTransition: null,
    usage: {
      contextWindow:
        contextWindow === null
          ? null
          : {
              usedTokens: lastPromptTokens(session),
              maxTokens: contextWindow,
              autoCompactThresholdTokens: null,
            },
      cumulative: cumulativeUsage(session),
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions,
    pendingCommands: [],
    backgroundWorks: [],
    subagents,
    goal,
    plan: planStateOf(session),
    workspaceHookAdmission: null,
    rows: {
      window: rows,
      totalCount: rows.length,
      firstRowId: rows[0]?.rowId ?? null,
    },
    workflowRuns: frame.workflowRunDeltas
      ? workflowRuns
      : clampWorkflowRunsForLegacy(workflowRuns),
  };
}

export function buildConversationFrame(
  frame: FrameSubscription,
  fromSeq: number,
  toSeq: number,
  payload: ConversationTopicFrame["payload"],
  deliveryKind: "initial" | "online" | "recovery",
): ConversationTopicWireFrame {
  const ordinal = frame.frameOrdinal + 1;
  frame.frameOrdinal = ordinal;
  const logical: ConversationTopicFrame = {
    topic: frame.topic,
    subscriptionId: frame.subscriptionId,
    fromSeq,
    toSeq,
    sentAt: Date.now(),
    payload,
  };
  return {
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "complete",
    deliveryKind,
    logicalFrameId: `${frame.subscriptionId}:frame-${ordinal}`,
    logicalFrameOrdinal: ordinal,
    topic: frame.topic,
    subscriptionId: frame.subscriptionId,
    frame: logical,
  };
}
