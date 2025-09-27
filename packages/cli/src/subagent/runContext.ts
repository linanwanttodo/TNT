import type {
  PermissionMode,
  ToolPermissionPolicy,
  ToolPermissions,
} from "../permissions/types.js";

/**
 * Everything a delegated agent needs that differs from the process-wide
 * services.
 *
 * The previous implementation overwrote the shared system message and
 * permission state on the global container and restored them afterwards, so two
 * concurrent delegations overwrote each other's system prompt and each other
 * permissions. Passing the differences explicitly removes that shared mutable
 * state: the values are fixed when the child context is built and are read-only
 * for the whole run.
 */
export interface AgentRunContext {
  readonly id: string;
  readonly parentContext: AgentRunContext | undefined;
  readonly delegationDepth: number;
  /** System prompt for this run, resolved once rather than read from a global. */
  readonly systemMessage: string;
  /**
   * Permissions for this run. Always a subset of the parent's, with every
   * "ask" downgraded to a decision the child can make on its own.
   */
  readonly permissions: ToolPermissions;
  readonly mode: PermissionMode;
  readonly abortSignal: AbortSignal;
}

export const READONLY_SUBAGENT_NOTICE =
  "This agent was started with a restricted tool set. It cannot write files or run commands, and the approval policy is fixed: it cannot be widened from inside this session.";

export const NO_WRITE_SUBAGENT_NOTICE =
  "This agent was started with a restricted tool set. It cannot create or modify files, but running commands and reading the workspace are available, and the approval policy is fixed: it cannot be widened from inside this session.";

/**
 * How a delegated agent may be narrower than the session that started it.
 *
 * A verifier has to run the build and the tests, so the only restriction that
 * makes sense for one is "no file writes" - dropping `Bash` as well would leave
 * it reading code and reporting a guess, which is the failure mode the whole
 * role exists to avoid.
 */
export type SubagentRestriction = "readonly" | "no-writes";

/** Tools that can change files or session state. */
const WRITE_TOOL_NAMES: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "ApplyPatch",
  "Create",
  "Checklist",
  "UploadArtifact",
];

/** Tools that run something outside the process. */
const EXEC_TOOL_NAMES: readonly string[] = ["Bash"];

function namesExcludedBy(
  restriction: SubagentRestriction | undefined,
): ReadonlySet<string> {
  if (restriction === "readonly") {
    return new Set([...WRITE_TOOL_NAMES, ...EXEC_TOOL_NAMES]);
  }
  if (restriction === "no-writes") {
    return new Set(WRITE_TOOL_NAMES);
  }
  return new Set<string>();
}

/**
 * Narrows a parent's permissions to what a child may keep.
 *
 * The result can only ever be narrower. A tool the parent was excluded from
 * stays excluded, and an "ask" the parent would have prompted for becomes
 * "exclude" rather than something the child can silently allow itself.
 */
export function narrowPermissions(
  parent: ToolPermissions,
  options: {
    restriction?: SubagentRestriction;
    /** Named tools this child never sees, on top of what the restriction cuts. */
    deniedTools?: readonly string[];
  },
): ToolPermissions {
  const excluded = new Set([
    ...namesExcludedBy(options.restriction),
    ...(options.deniedTools ?? []),
  ]);
  if (excluded.size === 0) {
    return {
      policies: parent.policies.map((policy) =>
        policy.permission === "ask"
          ? { ...policy, permission: "exclude" as const }
          : policy,
      ),
    };
  }

  const policies: ToolPermissionPolicy[] = [];
  for (const policy of parent.policies) {
    if (policy.tool === "*") {
      // The exclusions must come BEFORE the wildcard: the checker takes the
      // first matching policy, so a wildcard emitted first would shadow every
      // exclusion after it and the child would keep the mutating tools.
      for (const name of excluded) {
        policies.push({ tool: name, permission: "exclude" });
      }
      policies.push({
        tool: "*",
        permission: policy.permission === "exclude" ? "exclude" : "allow",
      });
      continue;
    }

    if (excluded.has(policy.tool)) {
      policies.push({ tool: policy.tool, permission: "exclude" });
      continue;
    }
    policies.push(
      policy.permission === "ask"
        ? { ...policy, permission: "exclude" as const }
        : policy,
    );
  }

  return { policies };
}

export function createChildContext(
  parent: AgentRunContext,
  overrides: {
    id: string;
    delegationDepth: number;
    systemMessage: string;
    abortSignal?: AbortSignal;
    restriction?: SubagentRestriction;
    deniedTools?: readonly string[];
  },
): AgentRunContext {
  const restriction = overrides.restriction;
  const restrictionNotice =
    restriction === "readonly"
      ? READONLY_SUBAGENT_NOTICE
      : restriction === "no-writes"
        ? NO_WRITE_SUBAGENT_NOTICE
        : undefined;
  const deniedNotice = overrides.deniedTools?.length
    ? `These tools are not available to you: ${overrides.deniedTools.join(", ")}.`
    : undefined;
  const notice = [restrictionNotice, deniedNotice]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return {
    id: overrides.id,
    parentContext: parent,
    delegationDepth: overrides.delegationDepth,
    // The child cannot see which tools are missing, so it is told what changed
    // and why it may not widen the policy itself.
    systemMessage: notice
      ? `${overrides.systemMessage}\n\n${notice}`
      : overrides.systemMessage,
    permissions: narrowPermissions(parent.permissions, {
      restriction,
      deniedTools: overrides.deniedTools,
    }),
    mode: parent.mode,
    abortSignal: overrides.abortSignal ?? parent.abortSignal,
  };
}
