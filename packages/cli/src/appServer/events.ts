import type { ZCodeSessionEvent, ZCodeSessionEventType } from "@zcode/shared";

import type { AgentEvent } from "../protocol/events.js";
import { logger } from "../utils/logger.js";

export interface TranslationState {
  readonly sessionId: string;
  seq: number;
  stateRevision: number;
  turnNumber: number;
  turnId: string | null;
  assistantMessageId: string | null;
  textPartId: string | null;
  reasoningPartId: string | null;
  text: string;
  reasoning: string;
  toolCallCount: number;
  turnStartedAt: number;
  turnTerminal: boolean;
  readonly toolStartedAt: Map<string, number>;
  /**
   * The tool call whose SummonTeam run is in flight. The ledger carries no
   * tool-call id, so this is the join key the workflow display uses when the
   * run opens, before the result event arrives.
   */
  summonTeamToolCallId: string | null;
}

export function createTranslationState(sessionId: string): TranslationState {
  return {
    sessionId,
    seq: 0,
    stateRevision: 0,
    turnNumber: 0,
    turnId: null,
    assistantMessageId: null,
    textPartId: null,
    reasoningPartId: null,
    text: "",
    reasoning: "",
    toolCallCount: 0,
    turnStartedAt: 0,
    turnTerminal: false,
    toolStartedAt: new Map(),
    summonTeamToolCallId: null,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toolIdentity(event: AgentEvent & { toolCallId?: string }): string {
  return event.toolCallId && event.toolCallId.length > 0
    ? event.toolCallId
    : `${event.turnId}:tool-${event.seq}`;
}

export function stamp(
  state: TranslationState,
  type: ZCodeSessionEventType,
  payload: unknown,
  timestamp: number,
  turnId?: string | null,
): ZCodeSessionEvent {
  state.seq += 1;
  state.stateRevision += 1;
  const event: Record<string, unknown> = {
    eventId: `${state.sessionId}:event-${state.seq}`,
    sessionId: state.sessionId,
    seq: state.seq,
    timestamp: Math.max(0, Math.floor(timestamp)),
    type,
  };
  if (turnId) {
    event.turnId = turnId;
  }
  if (payload !== undefined) {
    event.payload = payload;
  }
  return event as unknown as ZCodeSessionEvent;
}

function ensureTurnIdentity(state: TranslationState, event: AgentEvent): void {
  if (state.turnId === event.turnId && state.assistantMessageId) {
    return;
  }
  state.turnId = event.turnId;
  state.assistantMessageId = `${event.turnId}:assistant`;
  state.textPartId = `${state.assistantMessageId}:text`;
  state.reasoningPartId = `${state.assistantMessageId}:reasoning`;
}

function textPart(
  state: TranslationState,
  text: string,
): Record<string, unknown> {
  return {
    type: "text",
    partId: state.textPartId,
    sessionId: state.sessionId,
    messageId: state.assistantMessageId,
    text,
  };
}

function translateToolUpdated(
  state: TranslationState,
  event: Extract<AgentEvent, { type: "tool.updated" }>,
): ZCodeSessionEvent[] {
  const toolCallId = toolIdentity(event);
  const base = { toolCallId, toolName: event.toolName };
  if (event.status === "done") {
    return [
      stamp(
        state,
        "tool.updated",
        {
          ...base,
          kind: "result",
          result: { output: "", status: "done" },
          duration: 0,
        },
        event.timestamp,
        event.turnId,
      ),
    ];
  }
  if (event.status === "errored" || event.status === "canceled") {
    return [
      stamp(
        state,
        "tool.updated",
        {
          ...base,
          kind: "error",
          error: {
            type: event.status === "canceled" ? "ToolCancelled" : "ToolError",
            message:
              event.status === "canceled"
                ? "Tool call cancelled"
                : "Tool call failed",
          },
        },
        event.timestamp,
        event.turnId,
      ),
    ];
  }
  const startedAt = state.toolStartedAt.get(toolCallId);
  const elapsedMs =
    startedAt === undefined ? 0 : Math.max(0, event.timestamp - startedAt);
  return [
    stamp(
      state,
      "tool.updated",
      { ...base, kind: "progress", elapsedMs },
      event.timestamp,
      event.turnId,
    ),
  ];
}

function translateToolFinished(
  state: TranslationState,
  event: Extract<AgentEvent, { type: "tool.finished" }>,
): ZCodeSessionEvent[] {
  const toolCallId = toolIdentity(event);
  if (event.toolName === "SummonTeam") {
    state.summonTeamToolCallId = null;
  }
  const base = { toolCallId, toolName: event.toolName };
  const startedAt = state.toolStartedAt.get(toolCallId);
  const duration =
    startedAt === undefined ? 0 : Math.max(0, event.timestamp - startedAt);
  if (event.status === "done") {
    return [
      stamp(
        state,
        "tool.updated",
        {
          ...base,
          kind: "result",
          result: { output: event.result ?? "", status: "done" },
          duration,
        },
        event.timestamp,
        event.turnId,
      ),
    ];
  }
  if (event.status === "errored" || event.status === "canceled") {
    return [
      stamp(
        state,
        "tool.updated",
        {
          ...base,
          kind: "error",
          error: {
            type: event.status === "canceled" ? "ToolCancelled" : "ToolError",
            message: event.result || "Tool call failed",
          },
        },
        event.timestamp,
        event.turnId,
      ),
    ];
  }
  return translateToolUpdated(state, {
    ...event,
    type: "tool.updated",
    status: event.status,
  } as Extract<AgentEvent, { type: "tool.updated" }>);
}

function finishTurn(
  state: TranslationState,
  event: AgentEvent,
  response: string,
  resultType: "success" | "cancelled",
): ZCodeSessionEvent[] {
  const events: ZCodeSessionEvent[] = [];
  if (state.assistantMessageId && state.textPartId) {
    events.push(
      stamp(
        state,
        "part.upserted",
        { part: textPart(state, response) },
        event.timestamp,
        event.turnId,
      ),
    );
  }
  events.push(
    stamp(
      state,
      "turn.completed",
      {
        response,
        tokenCount: 0,
        toolCallCount: state.toolCallCount,
        duration: Math.max(0, event.timestamp - state.turnStartedAt),
        resultType,
      },
      event.timestamp,
      event.turnId,
    ),
  );
  state.turnTerminal = true;
  return events;
}

/**
 * Translates one engine event into the ZCode session-event vocabulary. Pure:
 * the only mutable input is `state`, and every returned event is stamped with
 * the next per-session seq (starting at 1). Events the UI has no shape for are
 * dropped here, never raised: a new engine event must not break the stream.
 */
export function translateAgentEvent(
  event: AgentEvent,
  state: TranslationState,
): ZCodeSessionEvent[] {
  switch (event.type) {
    case "turn.started": {
      ensureTurnIdentity(state, event);
      state.turnNumber += 1;
      state.text = "";
      state.reasoning = "";
      state.toolCallCount = 0;
      state.turnStartedAt = event.timestamp;
      state.turnTerminal = false;
      state.toolStartedAt.clear();
      return [
        stamp(
          state,
          "turn.started",
          {
            turnNumber: state.turnNumber,
            input: "",
            messageId: state.assistantMessageId,
            executionStartedAt: event.timestamp,
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "content.delta": {
      ensureTurnIdentity(state, event);
      state.text += event.delta;
      return [
        stamp(
          state,
          "part.delta",
          {
            messageId: state.assistantMessageId,
            partId: state.textPartId,
            field: "text",
            delta: event.delta,
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "reasoning.delta": {
      ensureTurnIdentity(state, event);
      state.reasoning += event.delta;
      return [
        stamp(
          state,
          "part.delta",
          {
            messageId: state.assistantMessageId,
            partId: state.reasoningPartId,
            field: "reasoning",
            delta: event.delta,
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "tool.started": {
      ensureTurnIdentity(state, event);
      const toolCallId = toolIdentity(event);
      state.toolCallCount += 1;
      state.toolStartedAt.set(toolCallId, event.timestamp);
      if (event.toolName === "SummonTeam") {
        state.summonTeamToolCallId = toolCallId;
      }
      return [
        stamp(
          state,
          "tool.updated",
          {
            kind: "started",
            toolCallId,
            toolName: event.toolName,
            startedAt: event.timestamp,
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "tool.updated":
      return translateToolUpdated(state, event);
    case "tool.finished":
      return translateToolFinished(state, event);
    case "turn.completed": {
      const response =
        state.text.length > 0 ? state.text : (event.content ?? "");
      return finishTurn(state, event, response, "success");
    }
    case "turn.interrupted":
      return finishTurn(state, event, state.text, "cancelled");
    case "turn.failed": {
      state.turnTerminal = true;
      return [
        stamp(
          state,
          "turn.failed",
          {
            error: {
              type: "turn_error",
              message: event.message || "Turn failed",
            },
            turnPhase: "execution",
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "permission.requested": {
      ensureTurnIdentity(state, event);
      const toolCallId =
        event.toolCallId ?? `${event.turnId}:tool-permission-${event.seq}`;
      return [
        stamp(
          state,
          "permission.requested",
          {
            requestId: event.requestId,
            toolCallId,
            toolName: event.toolName,
            riskLevel: "medium",
            reason: "Tool requires permission",
            input: asObject(event.toolArgs),
            options: [
              {
                optionId: "allow_once",
                kind: "allowOnce",
                name: "Allow once",
                response: { decision: "allow" },
              },
              {
                optionId: "allow_always",
                kind: "allowAlways",
                name: "Allow for this session",
                response: {
                  decision: "allow",
                  permissionUpdates: [
                    {
                      type: "addRules",
                      behavior: "allow",
                      rules: [{ toolName: event.toolName }],
                    },
                  ],
                },
              },
              {
                optionId: "deny",
                kind: "deny",
                name: "Deny",
                response: { decision: "deny" },
              },
            ],
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "question.requested": {
      const choices = event.options ? [...event.options] : undefined;
      return [
        stamp(
          state,
          "userInput.requested",
          {
            requestId: event.requestId,
            prompt: event.question,
            ...(choices && choices.length > 0
              ? { inputType: "choice", choices }
              : { inputType: "text" }),
          },
          event.timestamp,
          event.turnId,
        ),
      ];
    }
    case "question.answered":
      return [
        stamp(
          state,
          "userInput.resolved",
          { requestId: event.requestId, cancelled: false },
          event.timestamp,
          event.turnId,
        ),
      ];
    case "session.changed":
      return [
        stamp(
          state,
          "session.updated",
          { sessionId: event.sessionId },
          event.timestamp,
          event.turnId,
        ),
      ];
    default:
      logger.debug("AppServer: dropped unsupported agent event", {
        type: event.type,
        sessionId: event.sessionId,
        turnId: event.turnId,
      });
      return [];
  }
}
