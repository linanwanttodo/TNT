import type { PermissionMode } from "../../permissions/types.js";
import type { RealmId } from "../../realm/realmTree.js";
import type { ModelServiceState } from "../../services/types.js";
import type { AgentRunContext } from "../runContext.js";

export type SubagentRunStatus =
  "pending" | "running" | "waiting_input" | "done" | "failed" | "cancelled";

export interface SubagentRuntimeConfig {
  maxTurns?: number;
  allowedTools?: readonly string[];
  permissionMode?: PermissionMode;
  skills?: readonly string[];
  isolation?: "worktree";
}

export interface SubagentRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly realmId: RealmId;
  readonly agentType: string;
  readonly agent: ModelServiceState;
  readonly parentContext?: AgentRunContext;
  readonly maxDelegationDepth?: number;
  readonly config?: SubagentRuntimeConfig;
  readonly parentAbortController: AbortController;
  abortController: AbortController;
  readonly createdAt: number;
  updatedAt: number;
  status: SubagentRunStatus;
  pendingMessages: string[];
  teamRunId?: string;
  result?: { success: boolean; response: string; error?: string };
}

const runs = new Map<string, SubagentRun>();

let sequence = 0;

export function createSubagentRun(input: {
  sessionId: string;
  parentSessionId: string;
  realmId: RealmId;
  agent: ModelServiceState;
  parentContext?: AgentRunContext;
  maxDelegationDepth?: number;
  config?: SubagentRuntimeConfig;
  abortController?: AbortController;
  parentAbortController?: AbortController;
  teamRunId?: string;
}): SubagentRun {
  sequence += 1;
  const now = Date.now();
  const run: SubagentRun = {
    runId: `run-${sequence}-${input.sessionId}`,
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId,
    realmId: input.realmId,
    agentType: input.agent.model?.name ?? "agent",
    agent: input.agent,
    parentContext: input.parentContext,
    maxDelegationDepth: input.maxDelegationDepth,
    config: input.config,
    parentAbortController: input.parentAbortController ?? new AbortController(),
    abortController: input.abortController ?? new AbortController(),
    createdAt: now,
    updatedAt: now,
    status: "pending",
    pendingMessages: [],
    teamRunId: input.teamRunId,
  };
  runs.set(run.runId, run);
  return run;
}

export function getSubagentRun(runId: string): SubagentRun | undefined {
  return runs.get(runId);
}

export function findSubagentRunBySessionId(
  sessionId: string,
): SubagentRun | undefined {
  return [...runs.values()].find((run) => run.sessionId === sessionId);
}

export function listSubagentRuns(parentSessionId?: string): SubagentRun[] {
  return [...runs.values()].filter(
    (run) =>
      parentSessionId === undefined || run.parentSessionId === parentSessionId,
  );
}

export function updateSubagentRun(
  runId: string,
  updates: Partial<
    Pick<
      SubagentRun,
      | "status"
      | "pendingMessages"
      | "teamRunId"
      | "result"
      | "updatedAt"
      | "abortController"
    >
  >,
): SubagentRun | undefined {
  const run = runs.get(runId);
  if (!run) return undefined;
  Object.assign(run, updates, { updatedAt: Date.now() });
  return run;
}

export function clearSubagentRuns(): void {
  runs.clear();
  sequence = 0;
}
