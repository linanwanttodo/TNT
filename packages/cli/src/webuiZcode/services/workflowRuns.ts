import type { TeamRunRecord } from "core/index.js";

import { loadSessionById } from "../../session/index.js";
import { sessionStore } from "../../session/store.js";
import { teamRunsToWorkflowRunSummaries } from "../../appServer/workflowRunSummaries.js";

/**
 * The Workflow tab of the automations page: every team run of the workspace's
 * sessions, newest first.
 *
 * TNT keeps the team-run ledger on the session record, so there is no separate
 * journal to read: the list is the union of the sessions' ledgers, ordered by
 * when the run last moved. Sessions are read by id rather than kept open, so
 * a workspace with a hundred chats costs a hundred transcript reads at list
 * time and nothing afterwards.
 */

/** How many sessions the list walks. Older sessions are past the point where a run still matters. */
const MAX_SESSIONS_SCANNED = 200;

export interface WorkspaceWorkflowRun {
  runId: string;
  sessionId: string;
  sessionTitle: string;
  label: string;
  updatedAt: number;
  status: "pending" | "running" | "completed" | "errored" | "stopped";
  resumable: boolean;
  failureMessage?: string;
}

export function listWorkspaceWorkflowRuns(options: {
  workspacePath?: string;
  limit?: number;
}): WorkspaceWorkflowRun[] {
  const metas = sessionStore.list({
    includeSubagents: true,
    limit: MAX_SESSIONS_SCANNED,
  });
  const collected: WorkspaceWorkflowRun[] = [];

  for (const meta of metas) {
    if (
      options.workspacePath &&
      meta.workspaceDirectory !== options.workspacePath
    ) {
      continue;
    }
    const session = loadSessionById(meta.sessionId);
    const runs: readonly TeamRunRecord[] = session?.teamRuns ?? [];
    if (runs.length === 0) continue;
    for (const summary of teamRunsToWorkflowRunSummaries(runs, runs.length)) {
      collected.push({
        ...summary,
        sessionId: meta.sessionId,
        sessionTitle: meta.title,
      });
    }
  }

  collected.sort((left, right) => right.updatedAt - left.updatedAt);
  const limit = options.limit ?? collected.length;
  return collected.slice(0, Math.max(0, limit));
}
