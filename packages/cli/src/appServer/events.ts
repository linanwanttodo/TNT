/* eslint-disable max-lines -- event translation and the goal/usage observations share one per-session state machine */
import type { ZCodeSessionEvent, ZCodeSessionEventType } from "@zcode/shared";
import type { Session, TeamRunRecord, Usage } from "core/index.js";

import type { AgentEvent } from "../protocol/events.js";
import { sessionStore } from "../session/store.js";
import { logger } from "../utils/logger.js";

import { fullAccessPermissionOption } from "./interactionPayload.js";
import {
  deriveSubagentCounts,
  firstLine,
  listChildSessions,
  loadChildSession,
  readTeamRuns,
  subagentWireEvent,
  type SubagentLifecycle,
  type SubagentSessionRef,
} from "./subagents.js";

export interface TurnUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export type GoalVerificationOutcome = "pass" | "notSatisfied" | "failed";

export interface GoalVerificationRecord {
  iteration: number;
  outcome: GoalVerificationOutcome;
  at: number;
  anchorRowId: number | null;
  reason?: string;
}

/**
 * The goal lifecycle the app-server can derive from events it actually sees.
 * TNT persists only the objective string, so nothing here is inferred from it:
 * a turn starting under a goal makes it active, a user stop pauses it, and a
 * delegated verifier's verdict settles it. A goal with no observed lifecycle
 * stays null rather than being projected with invented states.
 */
export interface GoalLifecycleState {
  targetId: string;
  objective: string;
  status: "active" | "paused" | "verified" | "notSatisfied" | "failed";
  iteration: number;
  timeUsedSeconds: number;
  activeRunStartedAtMs: number | null;
  verifications: GoalVerificationRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface TranslationOptions {
  /** The persisted goal objective, or null when the session has none. */
  readGoal?: (sessionId: string) => string | null;
  /** The session's cumulative usage, used to derive one turn's share. */
  readUsage?: (sessionId: string) => TurnUsageSnapshot | null;
  /** The session's team-run ledger, or null when it cannot be read. */
  readTeamRuns?: (sessionId: string) => readonly TeamRunRecord[] | null;
  /** The direct child sessions of a parent, or null when unreadable. */
  readChildSessions?: (
    parentSessionId: string,
  ) => readonly SubagentSessionRef[] | null;
  /** Load one saved child transcript for measured counters. */
  loadChildSession?: (sessionId: string) => Session | null;
}

function storedSession(sessionId: string) {
  try {
    return sessionStore.load(sessionId)?.session ?? null;
  } catch {
    return null;
  }
}

function readStoredGoal(sessionId: string): string | null {
  const goal = storedSession(sessionId)?.goal?.trim();
  return goal && goal.length > 0 ? goal : null;
}

function readStoredUsage(sessionId: string): TurnUsageSnapshot | null {
  const usage = storedSession(sessionId)?.usage;
  if (!usage) {
    return null;
  }
  return {
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    cachedTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.completionTokensDetails?.reasoningTokens ?? 0,
  };
}

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
  /** Cumulative session usage when this turn started; null if it was missed. */
  turnUsageBaseline: TurnUsageSnapshot | null;
  /** Goal lifecycle observed in this process, or null when there is none. */
  goal: GoalLifecycleState | null;
  /** Delegated runs observed in this process, in dispatch order. */
  subagents: SubagentLifecycle[];
  /** Stable counter for subagent row identities. */
  subagentSeq: number;
  readonly readGoal: (sessionId: string) => string | null;
  readonly readUsage: (sessionId: string) => TurnUsageSnapshot | null;
  readonly readTeamRuns: (sessionId: string) => readonly TeamRunRecord[] | null;
  readonly readChildSessions: (
    parentSessionId: string,
  ) => readonly SubagentSessionRef[] | null;
  readonly loadChild: (sessionId: string) => Session | null;
}

export function createTranslationState(
  sessionId: string,
  options: TranslationOptions = {},
): TranslationState {
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
    turnUsageBaseline: null,
    goal: null,
    subagents: [],
    subagentSeq: 0,
    readGoal: options.readGoal ?? readStoredGoal,
    readUsage: options.readUsage ?? readStoredUsage,
    readTeamRuns: options.readTeamRuns ?? readTeamRuns,
    readChildSessions: options.readChildSessions ?? listChildSessions,
    loadChild: options.loadChildSession ?? loadChildSession,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function usageSnapshot(usage: Usage): TurnUsageSnapshot {
  return {
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    cachedTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.completionTokensDetails?.reasoningTokens ?? 0,
  };
}

function usageDelta(
  baseline: TurnUsageSnapshot | null,
  current: TurnUsageSnapshot | null,
): TurnUsageSnapshot | null {
  if (!baseline || !current) {
    return null;
  }
  const share = (end: number, start: number): number =>
    Math.max(0, end - start);
  return {
    promptTokens: share(current.promptTokens, baseline.promptTokens),
    completionTokens: share(
      current.completionTokens,
      baseline.completionTokens,
    ),
    cachedTokens: share(current.cachedTokens, baseline.cachedTokens),
    cacheWriteTokens: share(
      current.cacheWriteTokens,
      baseline.cacheWriteTokens,
    ),
    reasoningTokens: share(current.reasoningTokens, baseline.reasoningTokens),
  };
}

/**
 * The turn's own usage: what the producer attached when it knew, otherwise the
 * session's cumulative growth across this turn. Both are measurements; a turn
 * whose start was missed returns null instead of the whole session total.
 */
function turnUsageOf(
  state: TranslationState,
  event: AgentEvent,
): TurnUsageSnapshot | null {
  if (event.type !== "turn.completed" && event.type !== "turn.interrupted") {
    return null;
  }
  if (event.usage) {
    return usageSnapshot(event.usage);
  }
  return usageDelta(state.turnUsageBaseline, state.readUsage(state.sessionId));
}

/** The `usage` shape the desktop's turn-completed mapper reads. */
function zcodeUsagePayload(usage: TurnUsageSnapshot): Record<string, number> {
  const totalTokens = usage.promptTokens + usage.completionTokens;
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens,
    cachedReadTokens: usage.cachedTokens,
    cachedWriteTokens: usage.cacheWriteTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    ...(usage.reasoningTokens > 0
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
  };
}

function startGoalTurn(state: TranslationState, timestamp: number): void {
  const objective = state.readGoal(state.sessionId);
  if (!objective) {
    state.goal = null;
    return;
  }
  const previous = state.goal;
  if (previous && previous.objective === objective) {
    previous.iteration += 1;
    previous.status = "active";
    previous.activeRunStartedAtMs = timestamp;
    previous.updatedAt = timestamp;
    return;
  }
  state.goal = {
    targetId: `${state.sessionId}:goal`,
    objective,
    status: "active",
    iteration: 1,
    timeUsedSeconds: 0,
    activeRunStartedAtMs: timestamp,
    verifications: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function closeGoalTurn(
  state: TranslationState,
  timestamp: number,
  interrupted: boolean,
): void {
  const goal = state.goal;
  if (!goal) {
    return;
  }
  if (goal.activeRunStartedAtMs !== null) {
    goal.timeUsedSeconds += Math.max(
      0,
      Math.round((timestamp - goal.activeRunStartedAtMs) / 1_000),
    );
    goal.activeRunStartedAtMs = null;
  }
  if (interrupted && goal.status === "active") {
    goal.status = "paused";
  }
  goal.updatedAt = timestamp;
}

function observeGoalVerdict(
  state: TranslationState,
  verdict: string | undefined,
  timestamp: number,
): void {
  const goal = state.goal;
  const normalized = verdict?.toLowerCase();
  if (
    !goal ||
    (normalized !== "pass" && normalized !== "fail" && normalized !== "partial")
  ) {
    return;
  }
  const outcome: GoalVerificationOutcome =
    normalized === "pass"
      ? "pass"
      : normalized === "fail"
        ? "failed"
        : "notSatisfied";
  goal.status = outcome === "pass" ? "verified" : outcome;
  goal.verifications.push({
    iteration: goal.iteration,
    outcome,
    at: timestamp,
    anchorRowId: null,
  });
  goal.updatedAt = timestamp;
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
  closeGoalTurn(state, event.timestamp, resultType === "cancelled");
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
  const usage = turnUsageOf(state, event);
  events.push(
    stamp(
      state,
      "turn.completed",
      {
        response,
        tokenCount: usage ? usage.promptTokens + usage.completionTokens : 0,
        toolCallCount: state.toolCallCount,
        duration: Math.max(0, event.timestamp - state.turnStartedAt),
        ...(usage ? { usage: zcodeUsagePayload(usage) } : {}),
        resultType,
      },
      event.timestamp,
      event.turnId,
    ),
  );
  state.turnTerminal = true;
  return events;
}

/** The parent turn the delegation belongs to; subagent events carry the agent name. */
function parentTurnId(state: TranslationState): string {
  return (
    state.turnId ?? `${state.sessionId}:turn-${Math.max(1, state.turnNumber)}`
  );
}

function runningSubagent(
  state: TranslationState,
  agentName: string,
): SubagentLifecycle | undefined {
  return state.subagents.find(
    (candidate) =>
      candidate.agentName === agentName && candidate.status === "running",
  );
}

/**
 * A dispatch joins a team run only when exactly one still-running run has a
 * running member with that name. Two candidates mean the join would be a guess.
 */
function teamRunIdFor(
  state: TranslationState,
  agentName: string,
): string | null {
  const runs = state.readTeamRuns(state.sessionId) ?? [];
  const matches = runs.filter(
    (run) =>
      run.status === "running" &&
      run.members.filter(
        (member) =>
          member.name === agentName &&
          member.status === "running" &&
          !member.subagentSessionId,
      ).length === 1,
  );
  return matches.length === 1 ? matches[0].runId : null;
}

function claimedChildSessionIds(state: TranslationState): Set<string> {
  const claimed = new Set<string>();
  for (const run of state.subagents) {
    if (run.childSessionId) {
      claimed.add(run.childSessionId);
    }
  }
  return claimed;
}

/**
 * The saved transcript this dispatch produced. The team ledger wins when the
 * dispatch joined a run; otherwise the TUI's derivation is reused: the first
 * direct child with the same agent type that existed neither at start nor was
 * already claimed by an earlier dispatch.
 */
function childSessionFor(
  state: TranslationState,
  run: SubagentLifecycle,
): string | null {
  if (run.childSessionId) {
    return run.childSessionId;
  }
  if (run.runId) {
    const member = (state.readTeamRuns(state.sessionId) ?? [])
      .find((candidate) => candidate.runId === run.runId)
      ?.members.find((candidate) => candidate.name === run.agentName);
    if (member?.subagentSessionId) {
      return member.subagentSessionId;
    }
  }
  const claimed = claimedChildSessionIds(state);
  const candidate = (state.readChildSessions(state.sessionId) ?? []).find(
    (session) =>
      session.subagentType === run.agentName &&
      !run.childIdsAtStart.has(session.sessionId) &&
      !claimed.has(session.sessionId),
  );
  return candidate?.sessionId ?? null;
}

function startSubagent(
  state: TranslationState,
  event: Extract<AgentEvent, { type: "subagent.started" }>,
): ZCodeSessionEvent[] {
  const childIdsAtStart = new Set(
    (state.readChildSessions(state.sessionId) ?? []).map(
      (session) => session.sessionId,
    ),
  );
  state.subagentSeq += 1;
  const run: SubagentLifecycle = {
    id: `${state.sessionId}:subagent-${state.subagentSeq}`,
    agentName: event.agentName,
    turnId: parentTurnId(state),
    description: firstLine(event.prompt),
    startedAt: event.timestamp,
    status: "running",
    reported: "",
    endedAt: null,
    childSessionId: null,
    runId: teamRunIdFor(state, event.agentName),
    childIdsAtStart,
  };
  state.subagents.push(run);
  return [
    stamp(
      state,
      "session.updated",
      {
        sessionId: state.sessionId,
        subagent: subagentWireEvent(run, "started"),
      },
      event.timestamp,
      run.turnId,
    ),
  ];
}

function reportSubagent(
  state: TranslationState,
  event: Extract<AgentEvent, { type: "subagent.reported" }>,
): ZCodeSessionEvent[] {
  const run = runningSubagent(state, event.agentName);
  if (!run) {
    logger.debug("AppServer: dropped a report with no matching subagent", {
      sessionId: event.sessionId,
      agentName: event.agentName,
    });
    return [];
  }
  run.reported = event.content;
  return [
    stamp(
      state,
      "session.updated",
      {
        sessionId: state.sessionId,
        subagent: subagentWireEvent(run, "reported"),
      },
      event.timestamp,
      run.turnId,
    ),
  ];
}

function finishSubagent(
  state: TranslationState,
  event: Extract<AgentEvent, { type: "subagent.finished" }>,
): ZCodeSessionEvent[] {
  observeGoalVerdict(state, event.verdict, event.timestamp);
  const run = runningSubagent(state, event.agentName);
  if (!run) {
    logger.debug("AppServer: dropped a finish with no matching subagent", {
      sessionId: event.sessionId,
      agentName: event.agentName,
    });
    return [];
  }
  run.status = event.success ? "success" : "failed";
  run.endedAt = event.timestamp;
  if (event.content.length > 0) {
    run.reported = event.content;
  }
  if (event.verdict) {
    run.verdict = event.verdict;
  }
  const childSessionId = childSessionFor(state, run);
  if (childSessionId) {
    run.childSessionId = childSessionId;
    const counts = deriveSubagentCounts(childSessionId, state.loadChild);
    if (counts.toolUses !== undefined) {
      run.toolUses = counts.toolUses;
    }
    if (counts.tokens !== undefined) {
      run.tokens = counts.tokens;
    }
  }
  return [
    stamp(
      state,
      "session.updated",
      {
        sessionId: state.sessionId,
        subagent: subagentWireEvent(run, "finished"),
      },
      event.timestamp,
      run.turnId,
    ),
  ];
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
      state.turnUsageBaseline = state.readUsage(state.sessionId);
      startGoalTurn(state, event.timestamp);
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
      closeGoalTurn(state, event.timestamp, false);
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
              fullAccessPermissionOption(),
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
    case "subagent.started":
      return startSubagent(state, event);
    case "subagent.reported":
      return reportSubagent(state, event);
    case "subagent.finished":
      return finishSubagent(state, event);
    default:
      logger.debug("AppServer: dropped unsupported agent event", {
        type: event.type,
        sessionId: event.sessionId,
        turnId: event.turnId,
      });
      return [];
  }
}
