import type { ToolCallState } from "../../../../../core/index.js";

/**
 * Consecutive finished calls collapse into one row, regardless of tool name.
 * Running and queued calls stay visible so their state is never hidden.
 */
export interface ToolDisplayCluster {
  key: string;
  states: ToolCallState[];
  collapsed: boolean;
}

const FOLDABLE_STATUS = new Set(["done", "errored", "canceled"]);
const MIN_CLUSTER_SIZE = 2;

export function clusterToolStates(
  states: readonly ToolCallState[],
): ToolDisplayCluster[] {
  const clusters: ToolDisplayCluster[] = [];
  for (const state of states) {
    const foldable = FOLDABLE_STATUS.has(state.status);
    const previous = clusters[clusters.length - 1];
    if (
      foldable &&
      previous &&
      previous.states.length > 0 &&
      FOLDABLE_STATUS.has(previous.states[0].status)
    ) {
      previous.states.push(state);
      previous.collapsed = previous.states.length >= MIN_CLUSTER_SIZE;
      continue;
    }
    clusters.push({
      key: state.toolCallId || `tool-${clusters.length}`,
      states: [state],
      collapsed: false,
    });
  }
  return clusters;
}

/** One-line summary for a folded cluster, plus the count of hidden calls. */
export function clusterSummary(cluster: ToolDisplayCluster): {
  label: string;
  hidden: number;
} {
  const count = cluster.states.length;
  const failed = cluster.states.filter(
    (state) => state.status === "errored",
  ).length;
  return {
    label: `${count} calls${failed > 0 ? ` · ${failed} failed` : ""}`,
    hidden: count - 1,
  };
}
