import type {
  RunningSubagentSummary,
  SubagentProjectionState,
  SubagentRow,
} from "@zcode/shared/zcode-protocol-v4";
import type {
  Session,
  TeamRunMemberRecord,
  TeamRunRecord,
} from "core/index.js";

import { sessionStore } from "../session/store.js";
import { deriveSubagentUsage } from "../ui/subagentTree.js";

/** The tool names a root session uses to dispatch a delegated run. */
export const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Subagent",
  "Task",
  "Agent",
  "subagent",
]);

export type SubagentStatus = SubagentRow["status"];

export interface SubagentSessionRef {
  sessionId: string;
  subagentType?: string;
  dateCreated?: string;
  updatedAt?: string;
}

/** A live delegated run as observed from the agent event bus. */
export interface SubagentLifecycle {
  id: string;
  agentName: string;
  /** The parent conversation turn the delegation belongs to. */
  turnId: string;
  description: string;
  startedAt: number;
  status: SubagentStatus;
  reported: string;
  endedAt: number | null;
  childSessionId: string | null;
  /** The team run this dispatch joined, only when the join was unambiguous. */
  runId: string | null;
  verdict?: string;
  toolUses?: number;
  tokens?: number;
  childIdsAtStart: ReadonlySet<string>;
}

export interface SubagentWireEvent {
  event: "started" | "reported" | "finished";
  id: string;
  agentName: string;
  turnId: string;
  status: SubagentStatus;
  summary: string;
  startedAt: number;
  description: string;
  childSessionId?: string;
  runId?: string;
  verdict?: string;
  endedAt?: number;
  toolUses?: number;
  tokens?: number;
}

export interface SubagentCounts {
  toolUses?: number;
  tokens?: number;
}

export interface ReplaySubagentCall {
  turnId: string;
  goal?: string;
  members?: readonly string[];
}

export interface ReplaySubagentToolCall {
  turnId: string;
  type: string;
}

export interface ReplayedSubagent {
  turnId: string;
  agentName: string;
  status: SubagentStatus;
  summaryText: string;
  startedAt?: number;
  endedAt?: number;
  childSessionId?: string;
  runId?: string;
}

export interface ReplaySubagentOptions {
  childSessions: readonly SubagentSessionRef[];
  teamRuns: readonly TeamRunRecord[];
  summonTeamCalls: readonly ReplaySubagentCall[];
  subagentCalls: readonly ReplaySubagentToolCall[];
  /** Used when a persisted run cannot be tied to a turn without guessing. */
  fallbackTurnId: string;
  loadChildSession?: (sessionId: string) => Session | null;
}

export function firstLine(text: string | undefined | null): string {
  if (!text) {
    return "";
  }
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

/** The row's free-text summary: description plus only measured counters. */
export function composeSubagentSummaryText(input: {
  description?: string;
  toolUses?: number;
  tokens?: number;
  verdict?: string;
}): string {
  const parts: string[] = [];
  const description = firstLine(input.description);
  if (description) {
    parts.push(description);
  }
  if (input.toolUses !== undefined) {
    parts.push(`${input.toolUses} tool uses`);
  }
  if (input.tokens !== undefined) {
    parts.push(`${input.tokens} tokens`);
  }
  if (input.verdict) {
    parts.push(`verdict: ${input.verdict}`);
  }
  return parts.join(" · ");
}

export function timestampOf(value: string | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
}

export function readTeamRuns(
  sessionId: string,
): readonly TeamRunRecord[] | null {
  try {
    return sessionStore.load(sessionId)?.session.teamRuns ?? null;
  } catch {
    return null;
  }
}

export function listChildSessions(
  parentSessionId: string,
): readonly SubagentSessionRef[] {
  try {
    return sessionStore
      .list({ parentSessionId, includeSubagents: true })
      .map((meta) => ({
        sessionId: meta.sessionId,
        ...(meta.subagentType ? { subagentType: meta.subagentType } : {}),
        ...(meta.dateCreated ? { dateCreated: meta.dateCreated } : {}),
        ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
      }));
  } catch {
    return [];
  }
}

export function loadChildSession(sessionId: string): Session | null {
  try {
    return sessionStore.load(sessionId)?.session ?? null;
  } catch {
    return null;
  }
}

function countsFromSession(session: Session | null): SubagentCounts {
  if (!session) {
    return {};
  }
  const usage = deriveSubagentUsage(session.history);
  return {
    toolUses: usage.toolUses,
    ...(usage.tokens === null ? {} : { tokens: usage.tokens }),
  };
}

export function deriveSubagentCounts(
  sessionId: string,
  load: (sessionId: string) => Session | null = loadChildSession,
): SubagentCounts {
  return countsFromSession(load(sessionId));
}

export function subagentWireEvent(
  run: SubagentLifecycle,
  event: SubagentWireEvent["event"],
): SubagentWireEvent {
  return {
    event,
    id: run.id,
    agentName: run.agentName,
    turnId: run.turnId,
    status: run.status,
    summary: composeSubagentSummaryText({
      description: run.reported || run.description,
      ...(run.toolUses === undefined ? {} : { toolUses: run.toolUses }),
      ...(run.tokens === undefined ? {} : { tokens: run.tokens }),
      ...(run.verdict ? { verdict: run.verdict } : {}),
    }),
    startedAt: run.startedAt,
    description: run.description,
    ...(run.childSessionId ? { childSessionId: run.childSessionId } : {}),
    ...(run.runId ? { runId: run.runId } : {}),
    ...(run.verdict ? { verdict: run.verdict } : {}),
    ...(run.endedAt === null ? {} : { endedAt: run.endedAt }),
    ...(run.toolUses === undefined ? {} : { toolUses: run.toolUses }),
    ...(run.tokens === undefined ? {} : { tokens: run.tokens }),
  };
}

function asStatus(value: unknown): SubagentStatus {
  return value === "success" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "running"
    ? value
    : "running";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One wire event becomes one row. Status, times, child identity and summary are
 * taken from the payload; no counter or identity is synthesized here.
 */
export function subagentRowFromWire(
  payload: Record<string, unknown>,
  rowId: number,
  fallbackTurnId: string,
): SubagentRow | null {
  const agentName = asText(payload.agentName);
  if (!agentName) {
    return null;
  }
  const startedAt = payload.startedAt;
  const endedAt = payload.endedAt;
  const childSessionId = asText(payload.childSessionId);
  return {
    rowId,
    turnId: asText(payload.turnId) || fallbackTurnId,
    createdAt: 0,
    createdAtSeq: 0,
    kind: "subagent",
    subagentType: agentName,
    status: asStatus(payload.status),
    summaryText: asText(payload.summary),
    ...(childSessionId ? { childSessionId } : {}),
    ...(typeof startedAt === "number" ? { startedAt } : {}),
    ...(typeof endedAt === "number" ? { endedAt } : {}),
  };
}

/**
 * The `subagents` projection is derived from the same rows the client renders,
 * so a snapshot and a replayed frame agree on identity and counts.
 */
export function subagentProjectionFromRows(
  rows: readonly { kind: string }[],
  revision: number,
): SubagentProjectionState {
  const childSessionIds: string[] = [];
  const running: RunningSubagentSummary[] = [];
  let endedTotal = 0;
  for (const candidate of rows) {
    if (candidate.kind !== "subagent") {
      continue;
    }
    const row = candidate as SubagentRow;
    if (row.childSessionId && !childSessionIds.includes(row.childSessionId)) {
      childSessionIds.push(row.childSessionId);
    }
    if (row.status === "running") {
      // A started dispatch now carries the child session the executor created
      // before the run, so its live transcript is addressable. An older event
      // with no id stays out rather than being given an invented identity.
      if (row.childSessionId) {
        running.push({
          childSessionId: row.childSessionId,
          subagentType: row.subagentType,
          title: row.summaryText || row.subagentType,
          status: "running",
          ...(row.startedAt === undefined ? {} : { startedAt: row.startedAt }),
        });
      }
      continue;
    }
    endedTotal += 1;
  }
  return { revision, childSessionIds, running, endedTotal };
}

function memberStatus(
  status: TeamRunMemberRecord["status"],
): SubagentStatus | null {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running") return "running";
  return null;
}

function isEnded(status: SubagentStatus): boolean {
  return status !== "running";
}

function matchRunTurn(
  run: TeamRunRecord,
  calls: readonly ReplaySubagentCall[],
  used: Set<number>,
  fallback: string,
): string {
  const candidates = calls
    .map((call, index) => ({ call, index }))
    .filter(
      ({ call, index }) =>
        !used.has(index) && call.goal !== undefined && call.goal === run.goal,
    );
  if (candidates.length === 1) {
    used.add(candidates[0].index);
    return candidates[0].call.turnId;
  }
  return fallback;
}

function replayTeamRunRows(options: ReplaySubagentOptions): ReplayedSubagent[] {
  const rows: ReplayedSubagent[] = [];
  const usedCalls = new Set<number>();
  const pairedByIndex =
    options.summonTeamCalls.length === options.teamRuns.length;
  options.teamRuns.forEach((run, index) => {
    const turnId = pairedByIndex
      ? (options.summonTeamCalls[index]?.turnId ?? options.fallbackTurnId)
      : matchRunTurn(
          run,
          options.summonTeamCalls,
          usedCalls,
          options.fallbackTurnId,
        );
    for (const member of run.members) {
      const status = memberStatus(member.status);
      if (!status) {
        continue;
      }
      const childSessionId = member.subagentSessionId;
      const counts = childSessionId
        ? deriveSubagentCounts(childSessionId, options.loadChildSession)
        : {};
      const startedAt = timestampOf(member.startedAt);
      const endedAt = isEnded(status)
        ? timestampOf(member.finishedAt)
        : undefined;
      rows.push({
        turnId,
        agentName: member.name,
        status,
        summaryText: composeSubagentSummaryText({
          description: member.error,
          ...counts,
        }),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(endedAt === undefined ? {} : { endedAt }),
        ...(childSessionId ? { childSessionId } : {}),
        runId: run.runId,
      });
    }
  });
  return rows;
}

function lastAssistantText(session: Session): string {
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const message = session.history[index]?.message;
    if (message?.role !== "assistant") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
    }
  }
  return "";
}

function replayChildSessionRows(
  options: ReplaySubagentOptions,
  claimed: ReadonlySet<string>,
): ReplayedSubagent[] {
  const rows: ReplayedSubagent[] = [];
  const usedCalls = new Set<number>();
  for (const child of options.childSessions) {
    if (claimed.has(child.sessionId)) {
      continue;
    }
    const loaded = options.loadChildSession
      ? options.loadChildSession(child.sessionId)
      : loadChildSession(child.sessionId);
    const callIndex = child.subagentType
      ? options.subagentCalls.findIndex(
          (call, index) =>
            !usedCalls.has(index) && call.type === child.subagentType,
        )
      : -1;
    let turnId = options.fallbackTurnId;
    if (callIndex >= 0) {
      usedCalls.add(callIndex);
      turnId = options.subagentCalls[callIndex].turnId;
    }
    const startedAt = timestampOf(child.dateCreated);
    const endedAt = timestampOf(child.updatedAt) ?? startedAt;
    rows.push({
      turnId,
      agentName: child.subagentType ?? "subagent",
      status: "success",
      summaryText: composeSubagentSummaryText({
        description: loaded ? lastAssistantText(loaded) : "",
        ...countsFromSession(loaded),
      }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      childSessionId: child.sessionId,
    });
  }
  return rows;
}

/**
 * Rebuilds subagent rows from what persisted: the team-run ledger plus direct
 * child sessions. A run or child joins a turn only when the history carries a
 * matching tool call; otherwise the row stays in a headerless delegated group
 * rather than being attributed to a turn it may not belong to.
 */
export function replayedSubagents(
  options: ReplaySubagentOptions,
): ReplayedSubagent[] {
  const teamRows = replayTeamRunRows(options);
  const claimed = new Set<string>();
  for (const row of teamRows) {
    if (row.childSessionId) {
      claimed.add(row.childSessionId);
    }
  }
  return [...teamRows, ...replayChildSessionRows(options, claimed)];
}
