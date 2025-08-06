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
  "This agent was started with a restricted tool set. Operations that modify files, run commands, or call MCP servers are unavailable, and the approval policy is fixed: it cannot be widened from inside this session.";

/**
 * Tools that can change the workspace or run something outside it. A restricted
 * agent keeps the read-only tools and loses these.
 */
const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "ApplyPatch",
  "Create",
  "Checklist",
  "UploadArtifact",
]);

/**
 * Narrows a parent's permissions to what a child may keep.
 *
 * The result can only ever be narrower. A tool the parent was excluded from
 * stays excluded, and an "ask" the parent would have prompted for becomes
 * "exclude" rather than something the child can silently allow itself.
 */
export function narrowPermissions(
  parent: ToolPermissions,
  options: { readonly: boolean },
): ToolPermissions {
  if (!options.readonly) {
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
      // A wildcard in the parent still has to lose the mutating tools, so it is
      // replaced by an explicit allow for everything else plus an exclusion.
      policies.push({
        tool: "*",
        permission: policy.permission === "exclude" ? "exclude" : "allow",
      });
      for (const name of MUTATING_TOOL_NAMES) {
        policies.push({ tool: name, permission: "exclude" });
      }
      continue;
    }

    if (MUTATING_TOOL_NAMES.has(policy.tool)) {
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
    readonly?: boolean;
  },
): AgentRunContext {
  return {
    id: overrides.id,
    parentContext: parent,
    delegationDepth: overrides.delegationDepth,
    systemMessage: overrides.systemMessage,
    permissions: narrowPermissions(parent.permissions, {
      readonly: overrides.readonly ?? false,
    }),
    mode: parent.mode,
    abortSignal: overrides.abortSignal ?? parent.abortSignal,
  };
}
