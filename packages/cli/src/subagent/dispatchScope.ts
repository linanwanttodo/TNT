import { AsyncLocalStorage } from "async_hooks";

import type { AgentRunContext } from "./runContext.js";

/**
 * The parent context a nested dispatch inherits.
 *
 * A tool call made inside a delegated run does not receive the run's context:
 * `runAgentTurn` and the tool executor were built around the caller's session,
 * not the child's. Without this scope a member dispatched by a summoned lead
 * would look like a top-level dispatch from the main session, which would put
 * it at depth 1 and let the depth limit be bypassed by nesting.
 *
 * `AsyncLocalStorage` rather than a module variable because sibling dispatches
 * run concurrently: each nested call reads the scope of the branch that
 * created it, so two parallel members cannot see each other's depth or run.
 */
export interface DispatchScope {
  readonly context: AgentRunContext;
  readonly maxDelegationDepth: number;
}

const storage = new AsyncLocalStorage<DispatchScope>();

export function runInDispatchScope<T>(
  scope: DispatchScope,
  task: () => Promise<T>,
): Promise<T> {
  return storage.run(scope, task);
}

export function currentDispatchScope(): DispatchScope | undefined {
  return storage.getStore();
}
