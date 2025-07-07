/**
 * Delegation depth bookkeeping.
 *
 * A depth limit that lives only in memory can be reset by resuming a session,
 * because the resumed agent looks like a fresh top-level agent. So the depth is
 * persisted with the session and the two values are combined with a max: a
 * runtime value may deepen the count but never lower it.
 */

export const DEFAULT_MAX_SUBAGENT_DEPTH = 1;

export interface DelegationDepthHeader {
  /** Depth recorded when this session was created. */
  readonly delegationDepth?: number;
}

export interface DelegationContext {
  readonly delegationDepth: number;
  readonly maxDelegationDepth: number;
}

export class SubagentDepthError extends Error {
  constructor(
    readonly attemptedDepth: number,
    readonly maxDelegationDepth: number,
  ) {
    super(
      `Cannot delegate any deeper: this agent is already at depth ${attemptedDepth - 1}, which is the configured maximum of ${maxDelegationDepth}.`,
    );
    this.name = "SubagentDepthError";
  }
}

/**
 * Combines the persisted depth with the depth the runtime knows about, taking
 * the larger of the two so a resumed child cannot restart the count.
 */
export function delegationDepthOf(
  header: DelegationDepthHeader | undefined,
  runtimeDepth?: number,
): number {
  const fromHeader = header?.delegationDepth ?? 0;
  const fromRuntime = runtimeDepth ?? 0;
  return Math.max(fromHeader, fromRuntime);
}

export function resolveChildDepth(
  parent: DelegationContext,
  header?: DelegationDepthHeader,
): number {
  const parentDepth = delegationDepthOf(header, parent.delegationDepth);
  const childDepth = parentDepth + 1;
  if (!Number.isSafeInteger(childDepth)) {
    throw new RangeError(
      `Delegation depth overflowed: parent was at ${parentDepth}.`,
    );
  }
  if (childDepth > parent.maxDelegationDepth) {
    throw new SubagentDepthError(childDepth, parent.maxDelegationDepth);
  }
  return childDepth;
}

export function canDelegate(context: DelegationContext): boolean {
  return context.delegationDepth + 1 <= Math.max(1, context.maxDelegationDepth);
}
