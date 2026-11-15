import type { TeamRunRecord } from "core/index.js";

/**
 * The `workflowRuns` query answers a different question than the live
 * projection: the projection is a rich state key the conversation carries,
 * while the query is a plain list of what ran, what it is doing and whether it
 * can be resumed. The list needs a name and a timestamp, and the run ledger
 * has neither, so both are derived from the facts the ledger does hold.
 */

/** The five-value status vocabulary the query schema and the projection share. */
export type WorkflowRunSummaryStatus =
  "pending" | "running" | "completed" | "errored" | "stopped";

export interface WorkflowRunSummary {
  runId: string;
  label: string;
  updatedAt: number;
  status: WorkflowRunSummaryStatus;
  resumable: boolean;
  failureMessage?: string;
}

function statusOf(run: TeamRunRecord): WorkflowRunSummaryStatus {
  if (run.status === "running") {
    return run.members.some((member) => member.status === "running")
      ? "running"
      : "pending";
  }
  if (run.status === "failed") return "errored";
  const failed = run.members.find((member) => member.status === "failed");
  if (failed) return "errored";
  if (run.members.some((member) => member.status === "cancelled")) {
    return "stopped";
  }
  return "completed";
}

/**
 * A run can be resumed when it stopped for a reason the lead can act on: a
 * failed member, or a cancellation the user asked for. A run that completed
 * has nothing left to resume.
 */
function resumableOf(run: TeamRunRecord): boolean {
  if (run.status === "completed") return false;
  if (run.status === "failed") return true;
  return run.members.some(
    (member) => member.status === "failed" || member.status === "cancelled",
  );
}

function labelOf(run: TeamRunRecord): string {
  const members = run.members.map((member) => member.name);
  const roster = members.length > 0 ? members.join(", ") : "no members";
  return run.goal
    ? `${run.team}: ${run.goal} (${roster})`
    : `${run.team} (${roster})`;
}

function updatedAtOf(run: TeamRunRecord): number {
  const stamps = run.members
    .map((member) => member.finishedAt ?? member.startedAt)
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  const started = Date.parse(run.startedAt);
  const candidates = Number.isFinite(started) ? [started, ...stamps] : stamps;
  return candidates.length > 0 ? Math.max(...candidates) : Date.now();
}

/**
 * The newest run first. The ledger is append-ordered, so the reversed copy is
 * the recent end without sorting on a field that may tie.
 */
export function teamRunsToWorkflowRunSummaries(
  runs: readonly TeamRunRecord[],
  limit: number,
): WorkflowRunSummary[] {
  return [...runs]
    .reverse()
    .slice(0, Math.max(0, limit))
    .map((run) => {
      const failure = run.members.find((member) => member.error)?.error;
      return {
        runId: run.runId,
        label: labelOf(run).slice(0, 160),
        updatedAt: updatedAtOf(run),
        status: statusOf(run),
        resumable: resumableOf(run),
        ...(failure ? { failureMessage: failure.slice(0, 2048) } : {}),
      };
    });
}
