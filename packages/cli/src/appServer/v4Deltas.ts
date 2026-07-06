import type { ZCodeSessionEvent } from "@zcode/shared";
import type {
  ConversationDelta,
  ConversationRow,
  ToolCallDisplay,
  ToolCallRow,
  WorkflowRunsState,
} from "@zcode/shared/zcode-protocol-v4";
import type { TeamRunRecord } from "core/index.js";

import {
  subagentProjectionFromRows,
  subagentRowFromWire,
} from "./subagents.js";
import { controlState, turnBase, type FrameSubscription } from "./v4Frames.js";
import { activeTeamRun, teamRunWorkflowDisplay } from "./workflowRuns.js";

type Payload = Record<string, unknown>;

function asRecord(value: unknown): Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textDelta(
  frame: FrameSubscription,
  delta: string,
): ConversationDelta[] {
  const deltas: ConversationDelta[] = [];
  if (frame.textRowId === null) {
    frame.nextRowId += 1;
    frame.textRowId = frame.nextRowId;
    const row: ConversationRow = {
      ...turnBase(frame, frame.textRowId),
      kind: "assistantText",
      text: "",
      state: "streaming",
    };
    frame.rows.push(row);
    deltas.push({ op: "row.appended", row });
  }
  frame.text += delta;
  deltas.push({
    op: "row.delta",
    rowId: frame.textRowId,
    path: "text",
    append: delta,
  });
  return deltas;
}

function reasoningDelta(
  frame: FrameSubscription,
  delta: string,
): ConversationDelta[] {
  const deltas: ConversationDelta[] = [];
  if (frame.reasoningRowId === null) {
    frame.nextRowId += 1;
    frame.reasoningRowId = frame.nextRowId;
    const row: ConversationRow = {
      ...turnBase(frame, frame.reasoningRowId),
      kind: "reasoning",
      text: "",
      state: "streaming",
    };
    frame.rows.push(row);
    deltas.push({ op: "row.appended", row });
  }
  frame.reasoning += delta;
  deltas.push({
    op: "row.delta",
    rowId: frame.reasoningRowId,
    path: "summaryText",
    append: delta,
  });
  return deltas;
}

function turnStartedDeltas(
  frame: FrameSubscription,
  event: ZCodeSessionEvent,
): ConversationDelta[] {
  frame.turnNumber += 1;
  frame.turnId =
    "turnId" in event && typeof event.turnId === "string"
      ? event.turnId
      : `${frame.sessionId}:turn-${frame.turnNumber}`;
  frame.text = "";
  frame.reasoning = "";
  frame.textRowId = null;
  frame.reasoningRowId = null;
  frame.turnStartedAt = event.timestamp;
  frame.turnHeaderState = "running";
  frame.nextRowId += 1;
  frame.turnHeaderRowId = frame.nextRowId;
  const row: ConversationRow = {
    ...turnBase(frame, frame.turnHeaderRowId),
    kind: "turnHeader",
    origin: "userInput",
    state: "running",
    startedAt: event.timestamp,
  };
  frame.rows.push(row);
  return [
    { op: "row.appended", row },
    {
      op: "state.updated",
      patch: { control: controlState(true, event.timestamp) },
    },
  ];
}

function partUpsertedDeltas(
  frame: FrameSubscription,
  payload: Payload,
): ConversationDelta[] {
  const text = asText(asRecord(payload.part).text);
  frame.text = text;
  if (frame.textRowId === null) {
    frame.nextRowId += 1;
    frame.textRowId = frame.nextRowId;
    const row: ConversationRow = {
      ...turnBase(frame, frame.textRowId),
      kind: "assistantText",
      text,
      state: "complete",
    };
    frame.rows.push(row);
    return [{ op: "row.appended", row }];
  }
  const row: ConversationRow = {
    ...turnBase(frame, frame.textRowId),
    kind: "assistantText",
    text,
    state: "complete",
  };
  frame.rows = frame.rows.filter(
    (candidate) => candidate.rowId !== frame.textRowId,
  );
  frame.rows.push(row);
  return [{ op: "row.upserted", row }];
}

function toolCallDeltas(
  frame: FrameSubscription,
  payload: Payload,
  event: ZCodeSessionEvent,
  teamRuns?: readonly TeamRunRecord[],
): ConversationDelta[] {
  const toolCallId = asText(payload.toolCallId) || `tool-${event.seq}`;
  const toolName = asText(payload.toolName) || "tool";
  const kind = asText(payload.kind);
  const status: ToolCallRow["status"] =
    kind === "result" ? "success" : kind === "error" ? "error" : "running";
  const errorMessage =
    kind === "error" ? asText(asRecord(payload.error).message) : "";
  const existing = frame.toolRows.get(toolCallId);
  let rowId = existing?.rowId;
  if (rowId === undefined) {
    frame.nextRowId += 1;
    rowId = frame.nextRowId;
  }
  const run = toolName === "SummonTeam" ? activeTeamRun(teamRuns) : undefined;
  const row: ToolCallRow = {
    rowId,
    turnId: frame.turnId,
    createdAt: 0,
    createdAtSeq: 0,
    kind: "toolCall",
    toolCallId,
    toolName,
    status,
    inputText: JSON.stringify(payload.input ?? {}),
    ...(run ? { display: teamRunWorkflowDisplay(run, kind !== "error") } : {}),
    ...(kind === "result"
      ? { output: { text: asText(asRecord(payload.result).output) } }
      : {}),
    ...(kind === "error"
      ? {
          error: { code: "tool_error", message: errorMessage || "Tool failed" },
        }
      : {}),
    startedAt: frame.turnStartedAt || event.timestamp,
  };
  frame.toolRows.set(toolCallId, row);
  frame.rows = frame.rows.filter((candidate) => candidate.rowId !== rowId);
  frame.rows.push(row);
  return [existing ? { op: "row.upserted", row } : { op: "row.appended", row }];
}

function finalTurnDeltas(
  frame: FrameSubscription,
  state: "completedSuccess" | "completedInterrupted" | "failed",
  event: ZCodeSessionEvent,
): ConversationDelta[] {
  frame.turnHeaderState = state;
  const deltas: ConversationDelta[] = [];
  const payload = asRecord(
    "payload" in event ? (event as { payload?: unknown }).payload : undefined,
  );
  const usage = asRecord(payload.usage);
  const outputTokens =
    typeof usage.outputTokens === "number" && usage.outputTokens >= 0
      ? usage.outputTokens
      : undefined;
  if (frame.turnHeaderRowId !== null) {
    const row: ConversationRow = {
      ...turnBase(frame, frame.turnHeaderRowId),
      kind: "turnHeader",
      origin: "userInput",
      state,
      startedAt: frame.turnStartedAt,
      endedAt: event.timestamp,
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };
    frame.rows = frame.rows.filter(
      (candidate) => candidate.rowId !== frame.turnHeaderRowId,
    );
    frame.rows.push(row);
    deltas.push({ op: "row.upserted", row });
  }
  deltas.push({
    op: "state.updated",
    patch: { control: controlState(false, frame.turnStartedAt) },
  });
  return deltas;
}

function titleDeltas(payload: Payload): ConversationDelta[] {
  const source = asText(payload.source);
  return [
    {
      op: "state.updated",
      patch: {
        meta: {
          title: asText(payload.title),
          titleSource:
            source === "custom"
              ? "custom"
              : source === "generated"
                ? "generated"
                : "default",
        },
      },
    },
  ];
}

function permissionDeltas(
  event: ZCodeSessionEvent,
  payload: Payload,
): ConversationDelta[] {
  return [
    {
      op: "state.updated",
      patch: {
        pendingInteractions: [
          {
            interactionId:
              asText(payload.requestId) || `permission-${event.seq}`,
            kind: "permission",
            anchorRowId: null,
            createdAt: event.timestamp,
            payload: {
              kind: "permission",
              toolCallId: asText(payload.toolCallId),
              toolName: asText(payload.toolName),
              summary: asText(payload.reason) || "Tool requires permission",
              detail: payload.input ?? {},
              options: [
                {
                  optionId: "allow_once",
                  label: "Allow once",
                  kind: "allowOnce",
                  response: { decision: "allow" },
                },
                {
                  optionId: "allow_always",
                  label: "Allow for this session",
                  kind: "allowAlways",
                  response: {
                    decision: "allow",
                    permissionUpdates: [
                      {
                        type: "addRules",
                        behavior: "allow",
                        rules: [{ toolName: asText(payload.toolName) }],
                      },
                    ],
                  },
                },
                {
                  optionId: "deny",
                  label: "Deny",
                  kind: "deny",
                  response: { decision: "deny" },
                },
              ],
            },
          },
        ],
      },
    },
  ];
}

function userInputDeltas(
  event: ZCodeSessionEvent,
  payload: Payload,
): ConversationDelta[] {
  return [
    {
      op: "state.updated",
      patch: {
        pendingInteractions: [
          {
            interactionId: asText(payload.requestId) || `input-${event.seq}`,
            kind: "userInput",
            anchorRowId: null,
            createdAt: event.timestamp,
            payload: {
              kind: "userInput",
              prompt: asText(payload.prompt),
              freeText: true,
              ...(Array.isArray(payload.choices)
                ? {
                    options: payload.choices.map((choice, index) => ({
                      optionId: `option-${index}`,
                      label: String(choice),
                    })),
                  }
                : {}),
            },
          },
        ],
      },
    },
  ];
}

function displayUpsertDeltas(
  frame: FrameSubscription,
  payload: Payload,
): ConversationDelta[] {
  const toolCallId = asText(payload.toolCallId);
  if (!toolCallId) return [];
  const existing =
    frame.toolRows.get(toolCallId) ??
    frame.rows.find(
      (row): row is ToolCallRow =>
        row.kind === "toolCall" && row.toolCallId === toolCallId,
    );
  if (!existing) return [];
  const display = asRecord(payload.display) as ToolCallDisplay;
  const row: ToolCallRow = { ...existing, display };
  frame.toolRows.set(toolCallId, row);
  frame.rows = frame.rows.filter((candidate) => candidate.rowId !== row.rowId);
  frame.rows.push(row);
  return [{ op: "row.upserted", row }];
}

function subagentDeltas(
  frame: FrameSubscription,
  subagent: Payload,
  event: ZCodeSessionEvent,
): ConversationDelta[] {
  const id = asText(subagent.id);
  if (!id) {
    return [];
  }
  const existing = frame.subagentRows.get(id);
  const rowId = existing?.rowId ?? frame.nextRowId + 1;
  const row = subagentRowFromWire(subagent, rowId, frame.turnId);
  if (!row) {
    return [];
  }
  if (!existing) {
    frame.nextRowId = rowId;
  }
  frame.subagentRows.set(id, row);
  frame.rows = frame.rows.filter((candidate) => candidate.rowId !== row.rowId);
  frame.rows.push(row);
  return [
    existing ? { op: "row.upserted", row } : { op: "row.appended", row },
    {
      op: "state.updated",
      patch: {
        subagents: subagentProjectionFromRows(frame.rows, event.seq),
      },
    },
  ] as ConversationDelta[];
}

/**
 * Team-run changes ride `session.updated`: the ledger publisher appends one
 * event carrying either the `workflowRun.updated/removed` deltas, a display
 * for the SummonTeam row, or both. Keeping it on an existing event type means
 * the frame's seq advances exactly as it does for every other change.
 */
function sessionUpdatedDeltas(
  frame: FrameSubscription,
  payload: Payload,
  event: ZCodeSessionEvent,
): ConversationDelta[] {
  const deltas: ConversationDelta[] = [];
  if (frame.workflowRunDeltas) {
    if (Array.isArray(payload.workflowRunDeltas)) {
      deltas.push(...(payload.workflowRunDeltas as ConversationDelta[]));
    }
  } else if (payload.workflowRuns !== undefined) {
    // A subscriber without the capability gets the whole key, already clamped
    // by the producer, instead of key-level deltas it does not understand.
    deltas.push({
      op: "state.updated",
      patch: { workflowRuns: payload.workflowRuns as WorkflowRunsState },
    });
  }
  const display = asRecord(payload.teamWorkflowDisplay);
  deltas.push(...displayUpsertDeltas(frame, display));
  const subagent = asRecord(payload.subagent);
  if (Object.keys(subagent).length > 0) {
    deltas.push(...subagentDeltas(frame, subagent, event));
  }
  return deltas.length > 0 ? deltas : [{ op: "state.updated", patch: {} }];
}

/**
 * Encodes one translated session event as conversation deltas. The shapes are
 * exactly `conversationDeltaSchema`: text growth is `row.delta`, structural
 * change is a whole-row upsert, and everything without a row is a state patch.
 *
 * `teamRuns` is the session's current ledger. It lets a SummonTeam row carry
 * the `create_workflow` graph without the tool result having to transport it.
 */
export function deltasForEvent(
  frame: FrameSubscription,
  event: ZCodeSessionEvent,
  options: { teamRuns?: readonly TeamRunRecord[] } = {},
): ConversationDelta[] {
  const payload = asRecord(
    "payload" in event ? (event as { payload?: unknown }).payload : undefined,
  );
  switch (event.type) {
    case "turn.started":
      return turnStartedDeltas(frame, event);
    case "part.delta": {
      const delta = asText(payload.delta);
      const reasoning =
        asText(payload.field) === "reasoning" ||
        asText(payload.partId).endsWith(":reasoning");
      return reasoning ? reasoningDelta(frame, delta) : textDelta(frame, delta);
    }
    case "part.upserted":
      return partUpsertedDeltas(frame, payload);
    case "tool.updated":
      return toolCallDeltas(frame, payload, event, options.teamRuns);
    case "turn.completed":
      return finalTurnDeltas(
        frame,
        asText(payload.resultType) === "cancelled"
          ? "completedInterrupted"
          : "completedSuccess",
        event,
      );
    case "turn.failed":
      return finalTurnDeltas(frame, "failed", event);
    case "session.titleUpdated":
      return titleDeltas(payload);
    case "session.updated":
      return sessionUpdatedDeltas(frame, payload, event);
    case "permission.requested":
      return permissionDeltas(event, payload);
    case "userInput.requested":
      return userInputDeltas(event, payload);
    case "permission.resolved":
    case "userInput.resolved":
      return [{ op: "state.updated", patch: { pendingInteractions: [] } }];
    default:
      return [{ op: "state.updated", patch: {} }];
  }
}
