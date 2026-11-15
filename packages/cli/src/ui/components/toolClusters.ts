import type { ToolCallState } from "../../../../../core/index.js";

/**
 * Consecutive finished calls of the same tool collapse into one row, the way
 * a terminal-native CLI reports "Read 2 files, ran 1 shell command". Running
 * and failed calls stay visible on their own so their state is never hidden.
 */
export interface ToolDisplayCluster {
  key: string;
  toolName: string;
  states: ToolCallState[];
  collapsed: boolean;
}

const FOLDABLE_STATUS = new Set(["done", "canceled"]);
const MIN_CLUSTER_SIZE = 3;

export function clusterToolStates(
  states: readonly ToolCallState[],
): ToolDisplayCluster[] {
  const clusters: ToolDisplayCluster[] = [];
  for (const state of states) {
    const toolName = state.toolCall.function.name;
    const foldable = FOLDABLE_STATUS.has(state.status);
    const previous = clusters[clusters.length - 1];
    if (
      foldable &&
      previous &&
      previous.toolName === toolName &&
      previous.states.length > 0 &&
      FOLDABLE_STATUS.has(previous.states[0].status)
    ) {
      previous.states.push(state);
      previous.collapsed = previous.states.length >= MIN_CLUSTER_SIZE;
      continue;
    }
    clusters.push({
      key: state.toolCallId || `${toolName}-${clusters.length}`,
      toolName,
      states: [state],
      collapsed: false,
    });
  }
  return clusters;
}

/** One-line summary for a folded cluster, plus the count of hidden calls. */
export function clusterSummary(
  cluster: ToolDisplayCluster,
  displayName: string,
): { label: string; hidden: number } {
  const count = cluster.states.length;
  return {
    label: `${displayName} · ${count} calls`,
    hidden: count - 1,
  };
}
