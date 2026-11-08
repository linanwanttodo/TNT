import type {
  ConversationRow,
  ConversationSnapshot,
  ConversationTopicFrame,
  ConversationTopicWireFrame,
  ToolCallRow,
} from "@zcode/shared/zcode-protocol-v4";
import { V4_WIRE_PROTOCOL_VERSION } from "@zcode/shared/zcode-protocol-v4";
import type { Session } from "core/index.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";

import { toZcodeMessages } from "./snapshot.js";

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

function rowsFromSession(session: Session): ConversationRow[] {
  const rows: ConversationRow[] = [];
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
        const status = toolStatusOf(part.state.status);
        rows.push({
          ...base,
          kind: "toolCall",
          toolCallId: part.callId,
          toolName: part.tool,
          status,
          inputText: JSON.stringify(part.state.input ?? {}),
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
  return rows;
}

export function createFrameSubscription(
  session: Session,
  subscriptionId: string,
  logEpoch: string,
): FrameSubscription {
  const rows = rowsFromSession(session);
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

export function buildConversationSnapshot(
  session: Session,
  frame: FrameSubscription,
  cursor: { eventSeq: number; stateRevision: number },
  running: boolean,
): ConversationSnapshot {
  const { provider, model } = modelParts(session.chatModelTitle ?? undefined);
  const rows = [...frame.rows].sort((left, right) => left.rowId - right.rowId);
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
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: {
      window: rows,
      totalCount: rows.length,
      firstRowId: rows[0]?.rowId ?? null,
    },
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
