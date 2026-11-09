import type {
  ConversationDelta,
  ToolCallCreateWorkflowDisplay,
  WorkflowRunActor,
  WorkflowRunNode,
  WorkflowRunState,
  WorkflowRunsState,
} from "@zcode/shared/zcode-protocol-v4";
import { WORKFLOW_RUNS_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import type {
  Session,
  TeamMemberRunStatus,
  TeamRunRecord,
  TeamRunStatus,
} from "core/index.js";

import {
  buildTeamWorkflowGraph,
  teamRunWaveIds,
  teamWorkflowDisplay,
  teamWorkflowGraphFor,
} from "../session/teamWorkflow.js";
import { MAX_CONCURRENT_TEAM_MEMBERS } from "../subagent/memberLimiter.js";

import { deriveSubagentCounts } from "./subagents.js";

/** The snapshot keeps the same bounded window the protocol schema does. */
const RUN_WINDOW = WORKFLOW_RUNS_LIMITS.maxRuns;

/**
 * What the projection may read besides the ledger. A member's token count is
 * not persisted in the ledger: it is measured from the child session the
 * dispatch saved, exactly as the subagents projection does.
 */
export interface WorkflowRunProjectionOptions {
  loadChildSession?: (sessionId: string) => Session | null;
}

function memberSpentTokens(
  member: TeamRunRecord["members"][number],
  options: WorkflowRunProjectionOptions,
): number | undefined {
  if (!member.subagentSessionId) return undefined;
  return deriveSubagentCounts(
    member.subagentSessionId,
    options.loadChildSession,
  ).tokens;
}

function bounded(value: string, max: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, max);
}

function actorStatus(status: TeamMemberRunStatus): WorkflowRunActor["status"] {
  switch (status) {
    case "running":
      return "running";
    case "pending":
      return "waiting";
    case "completed":
    case "failed":
      // The schema has no actor-level failure: the outcome lives on the node.
      return "completed";
  }
}

function nodePhase(status: TeamMemberRunStatus): WorkflowRunNode["phase"] {
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "executing";
    case "completed":
    case "failed":
      return "settled";
  }
}

function runStatus(status: TeamRunStatus): WorkflowRunState["status"] {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "errored";
  }
}

function dispatchedCount(run: TeamRunRecord): number {
  return run.members.filter((member) => member.status !== "pending").length;
}

function memberError(run: TeamRunRecord): string | undefined {
  const failed = run.members.find((member) => member.error);
  return failed?.error?.slice(0, WORKFLOW_RUNS_LIMITS.maxErrorLength);
}

/**
 * Projects one team-run ledger entry into the `workflowRuns` vocabulary.
 *
 * One member = one actor + one ask node. TNT dispatches each member at most
 * once per run, so the member index is the instance ordinal. The graph names
 * the lane `member-<n>` and the step `step-<n>`; actors join lanes and nodes
 * join steps, which is what lets the live overlay light the static graph. The
 * human roster name stays in `actor.name`. The wave (built with the same helper
 * as the static graph) is both the node's `phaseName` and its actor's birth
 * phase.
 */
export function projectTeamRun(
  run: TeamRunRecord,
  revision: number,
  options: WorkflowRunProjectionOptions = {},
): WorkflowRunState {
  const waveIds = teamRunWaveIds(run.mode, run.members.length);

  const actors: WorkflowRunActor[] = run.members.map((member, index) => ({
    // The join key is the static graph's lane, not the human name: the UI
    // narrows a node to a lane with `node.actorSiteId === lane.id`.
    siteId: `member-${index + 1}`,
    ordinal: index,
    name: bounded(
      member.name,
      WORKFLOW_RUNS_LIMITS.maxActorNameLength,
      `member-${index + 1}`,
    ),
    ...(member.model
      ? {
          model: member.model.slice(
            0,
            WORKFLOW_RUNS_LIMITS.maxSubagentModelLength,
          ),
        }
      : {}),
    ...(member.subagentSessionId
      ? {
          sessionId: member.subagentSessionId.slice(
            0,
            WORKFLOW_RUNS_LIMITS.maxSessionIdLength,
          ),
        }
      : {}),
    status: actorStatus(member.status),
    phaseName: waveIds[index] ?? "wave-1",
  }));

  const nodes: WorkflowRunNode[] = run.members.map((member, index) => ({
    siteId: `step-${index + 1}`,
    ordinal: index,
    kind: "ask",
    phase: nodePhase(member.status),
    ...(member.status === "completed"
      ? { outcome: "ok" as const }
      : member.status === "failed"
        ? { outcome: "failed" as const }
        : {}),
    actorSiteId: `member-${index + 1}`,
    actorOrdinal: index,
    phaseName: waveIds[index] ?? "wave-1",
    instructionsHead: bounded(
      run.goal,
      WORKFLOW_RUNS_LIMITS.maxInstructionsHeadLength,
      run.team || "team run",
    ),
  }));

  const declaredPhases = [...new Set(waveIds)];
  const reachedPhases = [
    ...new Set(
      run.members
        .map((member, index) =>
          member.status === "pending" ? undefined : waveIds[index],
        )
        .filter((wave): wave is string => wave !== undefined),
    ),
  ];
  const currentPhase = [...run.members]
    .map((member, index) => ({ member, wave: waveIds[index] }))
    .reverse()
    .find((entry) => entry.member.status === "running")?.wave;
  const error = run.status === "failed" ? memberError(run) : undefined;

  // Tokens are measured from each member's saved child session; a member with
  // no session (or a session with no reported usage) contributes nothing.
  let spentTokens = 0;
  for (const member of run.members) {
    const tokens = memberSpentTokens(member, options);
    if (tokens !== undefined) spentTokens += tokens;
  }

  // The schema's only report field is the run-level `reports` table, keyed by
  // (siteId, ordinal). A member's final report is emitted under its node's
  // identity so the entry lines up with `nodes[]`.
  const reports = run.members.flatMap((member, index) =>
    member.report
      ? [
          {
            siteId: `step-${index + 1}`,
            ordinal: index,
            preview: member.report.slice(
              0,
              WORKFLOW_RUNS_LIMITS.maxReportPreviewLength,
            ),
          },
        ]
      : [],
  );

  // `cap` is the number of members this run may have in flight at once;
  // `ceiling` is the process-wide member limiter. A run ledger that carries no
  // concurrency (auto mode) claims neither.
  const concurrency =
    run.concurrency !== undefined && run.concurrency > 0
      ? Math.min(run.concurrency, MAX_CONCURRENT_TEAM_MEMBERS)
      : undefined;

  return {
    runId: run.runId.slice(0, 128),
    status: runStatus(run.status),
    usage: {
      spentTokens,
      nodesUsed: dispatchedCount(run),
    },
    ...(error ? { error } : {}),
    actors,
    nodes,
    ...(reports.length > 0 ? { reports } : {}),
    ...(concurrency === undefined
      ? {}
      : {
          concurrency: {
            cap: concurrency,
            ceiling: MAX_CONCURRENT_TEAM_MEMBERS,
          },
          concurrencyCeiling: MAX_CONCURRENT_TEAM_MEMBERS,
        }),
    ...(declaredPhases.length > 0 ? { phaseNames: declaredPhases } : {}),
    ...(reachedPhases.length > 0
      ? {
          phases: reachedPhases.map((name) => ({ name, rounds: 1 })),
        }
      : {}),
    ...(currentPhase ? { currentPhase } : {}),
    lastEventSequence: revision,
  };
}

/**
 * The conversation snapshot's `workflowRuns` key: the newest bounded window of
 * the ledger, projected. Empty runs still yield `{ revision, runs: [] }` so a
 * client never has to tell "no key" from "no team work".
 */
export function teamRunsToWorkflowRuns(
  runs: readonly TeamRunRecord[],
  revision: number,
  options: WorkflowRunProjectionOptions = {},
): WorkflowRunsState {
  return {
    revision,
    runs: runs
      .slice(-RUN_WINDOW)
      .map((run) => projectTeamRun(run, revision, options)),
  };
}

function sameRun(left: TeamRunRecord, right: TeamRunRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Header keys that can lose their value between two projections. A delta's
 * `run` patch only replaces values, so a key that disappeared has to be named
 * in `cleared` or the client keeps the stale value.
 */
const CLEARABLE_HEADER_KEYS = [
  "concurrency",
  "concurrencyCeiling",
  "currentPhase",
  "error",
  "phases",
  "phaseNames",
  "reports",
] as const;

function runWindow(runs: readonly TeamRunRecord[]): TeamRunRecord[] {
  return runs.slice(-RUN_WINDOW);
}

/**
 * The deltas one ledger mutation produces. A changed run is upserted whole
 * (header + both identity tables); a run pushed out of the bounded window is
 * removed explicitly, because only the producer is allowed to apply a cap.
 * Unchanged runs produce nothing, so a member's status change is O(1) on the
 * wire rather than a snapshot of every run.
 */
export function buildWorkflowRunDeltas(
  previous: readonly TeamRunRecord[] | undefined,
  next: readonly TeamRunRecord[],
  revision: number,
  options: WorkflowRunProjectionOptions = {},
): ConversationDelta[] {
  const previousWindow = runWindow(previous ?? []);
  const nextWindow = runWindow(next);
  const previousById = new Map(previousWindow.map((run) => [run.runId, run]));
  const nextIds = new Set(nextWindow.map((run) => run.runId));
  const deltas: ConversationDelta[] = [];

  for (const run of nextWindow) {
    const before = previousById.get(run.runId);
    if (before && sameRun(before, run)) continue;
    const projected = projectTeamRun(run, revision, options);
    const { actors, nodes, ...header } = projected;
    const headerRecord = header as Record<string, unknown>;
    const cleared = CLEARABLE_HEADER_KEYS.filter(
      (key) => headerRecord[key] === undefined,
    );
    deltas.push({
      op: "workflowRun.updated",
      runId: projected.runId,
      revision,
      run: header,
      ...(cleared.length > 0 ? { cleared: [...cleared] } : {}),
      actors,
      nodes,
    });
  }

  for (const run of previousWindow) {
    if (!nextIds.has(run.runId)) {
      deltas.push({
        op: "workflowRun.removed",
        runId: run.runId.slice(0, 128),
        revision,
      });
    }
  }

  return deltas;
}

/**
 * The `create_workflow` display for a run: the graph remembered from the
 * roster when available, otherwise rebuilt from the persisted ledger (labels
 * fall back to the goal head, which is all a resumed session still has).
 */
export function teamRunWorkflowDisplay(
  run: TeamRunRecord,
  ok: boolean,
): ToolCallCreateWorkflowDisplay {
  const graph =
    teamWorkflowGraphFor(run.runId) ??
    buildTeamWorkflowGraph({
      team: run.team,
      goal: run.goal,
      mode: run.mode,
      members: run.members.map((member) => ({ name: member.name })),
    });
  return teamWorkflowDisplay(graph, ok);
}

/**
 * The run a SummonTeam row belongs to. The ledger has no tool-call id, so the
 * live run wins; a finished row falls back to the newest run.
 */
export function activeTeamRun(
  runs: readonly TeamRunRecord[] | undefined,
): TeamRunRecord | undefined {
  if (!runs || runs.length === 0) return undefined;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index].status === "running") return runs[index];
  }
  return runs[runs.length - 1];
}
