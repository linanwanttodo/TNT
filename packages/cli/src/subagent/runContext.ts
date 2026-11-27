import {
  ACCEPT_EDITS_MODE_POLICIES,
  BYPASS_PERMISSIONS_POLICIES,
  DONT_ASK_MODE_POLICIES,
  getDefaultToolPolicies,
  PLAN_MODE_POLICIES,
} from "../permissions/defaultPolicies.js";
import { matchesToolPattern } from "../permissions/permissionChecker.js";
import type {
  AdvertiseBasis,
  PermissionMode,
  ToolPermissionPolicy,
  ToolPermissions,
} from "../permissions/types.js";
import type { RealmId } from "../realm/realmTree.js";
import type { SubagentRestriction } from "../team/restrictions.js";

export type { SubagentRestriction };

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
   * What the family's requests advertise: the root run's permission view and
   * headless-ness. Every delegated run inherits it unchanged, so the tool
   * bytes it sends stay identical to the run that spawned it and the provider
   * keeps reading the shared cached prefix. Execution still uses this run's
   * own narrowed `permissions`.
   */
  readonly advertise: AdvertiseBasis;
  /**
   * Permissions for this run. Always a subset of the parent's, with every
   * "ask" downgraded to a decision the child can make on its own.
   */
  readonly permissions: ToolPermissions;
  readonly mode: PermissionMode;
  readonly abortSignal: AbortSignal;
  /** Runtime isolation realm; nested dispatches fork from this value. */
  readonly realmId?: RealmId;
  /** Isolated filesystem root for this delegated run. */
  readonly workspaceRoot?: string;
}

export const READONLY_SUBAGENT_NOTICE =
  "This agent was started with a restricted tool set. It cannot write files or run commands, and the approval policy is fixed: it cannot be widened from inside this session.";

export const NO_WRITE_SUBAGENT_NOTICE =
  "This agent was started with a restricted tool set. It cannot create or modify files, but running commands and reading the workspace are available, and the approval policy is fixed: it cannot be widened from inside this session.";

/**
 * How a delegated agent may be narrower than the session that started it. The
 * type itself lives in `team/restrictions.js`; re-exported here for the
 * run-context consumers.
 */

/** Tools that can change files or session state. */
const WRITE_TOOL_NAMES: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "ApplyPatch",
  "Create",
  "Checklist",
  "UploadArtifact",
  // It does not write the workspace, but it can click and type in anything the
  // user has open, so a child promised "no writes" must not hold it.
  "Computer",
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
function policiesForMode(mode: PermissionMode): ToolPermissions {
  switch (mode) {
    case "plan":
      return { policies: PLAN_MODE_POLICIES };
    case "acceptEdits":
      return { policies: ACCEPT_EDITS_MODE_POLICIES };
    case "bypassPermissions":
      return { policies: BYPASS_PERMISSIONS_POLICIES };
    case "dontAsk":
      return { policies: DONT_ASK_MODE_POLICIES };
    default:
      return { policies: getDefaultToolPolicies() };
  }
}

function applyToolAllowlist(
  permissions: ToolPermissions,
  allowedTools?: readonly string[],
): ToolPermissions {
  if (!allowedTools) return permissions;
  const allowed = new Set([...allowedTools, "SendMessage"]);
  const policies: ToolPermissionPolicy[] = [];
  for (const policy of permissions.policies) {
    if (policy.tool === "*") continue;
    if (
      allowed.has(policy.tool) ||
      [...allowed].some((pattern) => matchesToolPattern(policy.tool, pattern))
    ) {
      policies.push(policy);
    }
  }
  for (const pattern of allowed) {
    if (policies.some((policy) => policy.tool === pattern)) continue;
    const inherited = permissions.policies.find((policy) =>
      matchesToolPattern(pattern, policy.tool),
    );
    policies.push(
      inherited
        ? { ...inherited, tool: pattern }
        : { tool: pattern, permission: "exclude" },
    );
  }
  policies.push({ tool: "*", permission: "exclude" });
  return { policies };
}

export function narrowPermissions(
  parent: ToolPermissions,
  options: {
    restriction?: SubagentRestriction;
    /** Named tools this child never sees, on top of what the restriction cuts. */
    deniedTools?: readonly string[];
    /** When present, only these tools plus SendMessage remain available. */
    allowedTools?: readonly string[];
  },
): ToolPermissions {
  const excluded = new Set([
    ...namesExcludedBy(options.restriction),
    ...(options.deniedTools ?? []),
  ]);
  if (excluded.size === 0) {
    return applyToolAllowlist(
      {
        policies: parent.policies.map((policy) =>
          policy.permission === "ask"
            ? { ...policy, permission: "exclude" as const }
            : policy,
        ),
      },
      options.allowedTools,
    );
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

    if (
      [...excluded].some((pattern) => matchesToolPattern(policy.tool, pattern))
    ) {
      policies.push({ tool: policy.tool, permission: "exclude" });
      continue;
    }
    policies.push(
      policy.permission === "ask"
        ? { ...policy, permission: "exclude" as const }
        : policy,
    );
  }

  return applyToolAllowlist({ policies }, options.allowedTools);
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
    allowedTools?: readonly string[];
    permissionMode?: PermissionMode;
    realmId?: RealmId;
    workspaceRoot?: string;
  },
): AgentRunContext {
  const restriction = overrides.restriction;
  const mode = overrides.permissionMode ?? parent.mode;
  const basePermissions =
    mode === parent.mode ? parent.permissions : policiesForMode(mode);
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
    permissions: narrowPermissions(basePermissions, {
      restriction,
      deniedTools: overrides.deniedTools,
      allowedTools: overrides.allowedTools,
    }),
    mode,
    abortSignal: overrides.abortSignal ?? parent.abortSignal,
    advertise: parent.advertise,
    realmId: overrides.realmId ?? parent.realmId,
    workspaceRoot: overrides.workspaceRoot ?? parent.workspaceRoot,
  };
}
