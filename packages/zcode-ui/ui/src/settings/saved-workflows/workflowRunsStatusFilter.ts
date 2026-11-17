/* Workflow 运行列表的状态筛选：与 automationStatusFilter.ts 同一形状，口径按 team run 的五态归纳。
   pending 与 running 都还会推进，归「运行」；errored 与 stopped 是非正常结束，各自成组。 */
import type { ZCodeWorkflowRunSummary } from "@zcode/shared";

export type WorkflowRunStatusFilter = "all" | "running" | "completed" | "failed" | "stopped";
export type WorkflowRunStatusFilterKind = Exclude<WorkflowRunStatusFilter, "all">;

/** 默认筛选：不过滤。 */
export const DEFAULT_WORKFLOW_RUN_STATUS_FILTER: WorkflowRunStatusFilter = "all";

export const WORKFLOW_RUN_STATUS_FILTERS: readonly WorkflowRunStatusFilter[] = [
  "all",
  "running",
  "completed",
  "failed",
  "stopped",
];

export function resolveWorkflowRunStatusFilterKind(
  run: Pick<ZCodeWorkflowRunSummary, "status">,
): WorkflowRunStatusFilterKind {
  switch (run.status) {
    case "completed":
      return "completed";
    case "errored":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return "running";
  }
}

export function filterWorkflowRunsByStatus(
  runs: readonly ZCodeWorkflowRunSummary[],
  filter: WorkflowRunStatusFilter,
): readonly ZCodeWorkflowRunSummary[] {
  if (filter === "all") return runs;
  return runs.filter((run) => resolveWorkflowRunStatusFilterKind(run) === filter);
}

/**
 * 失败/停止且 resumable=true 的 run 才有「打开会话」强调入口；
 * resumable=false 就不渲染（无合成值），运行中/已完成的行不需要强调。
 */
export function hasWorkflowRunOpenSessionEntry(
  run: Pick<ZCodeWorkflowRunSummary, "status" | "resumable">,
): boolean {
  return run.resumable && (run.status === "errored" || run.status === "stopped");
}
