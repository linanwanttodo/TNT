import { ROOT_REALM } from "../../realm/realmTree.js";
import type { AgentRunContext } from "../runContext.js";

/**
 * The runtime context for a delegated agent run.
 *
 * It resolves the run's own realm first, then resolves the parent context
 * through that realm. This is what makes "the subagent sees its own tools"
 * true rather than "the subagent sees the parent's tools".
 *
 * `realmId` is the delegated run's own realm: the team realm or the agent
 * realm it forked from the root.
 */
export interface RuntimeContext {
  readonly realmId: number;
  readonly parentContext: AgentRunContext;
}

export function resolveRuntimeContext(
  parentContext: AgentRunContext,
  realmTree: {
    fork: (parent: number) => number;
  },
): RuntimeContext {
  // The delegated run lives in its own child realm of the parent's realm.
  // For a subagent, the parent is usually the ROOT or a team realm; the
  // subagent gets a child of that.
  const parentRealm =
    (parentContext as { realmId?: number }).realmId ?? ROOT_REALM;
  const realmId = realmTree.fork(parentRealm);
  return { realmId, parentContext };
}
