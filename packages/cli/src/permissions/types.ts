import { ToolCallPreview } from "../tools/types.js";

export type PermissionPolicy = "allow" | "ask" | "exclude";

export type PermissionMode =
  "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions" | "dontAsk";

/** Every value `--permission-mode` accepts; `auto` is refused until implemented. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
  "dontAsk",
];

/**
 * Modes whose own policy table replaces the configuration layers. `default`
 * and `auto` keep the user's rules.
 */
export const ABSOLUTE_POLICY_MODES: readonly PermissionMode[] = [
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
];

export interface ToolPermissionPolicy {
  /** The tool name to match against */
  tool: string;
  /** The permission to apply */
  permission: PermissionPolicy;
  /** Optional argument matching patterns. If not specified, applies to all calls to this tool */
  argumentMatches?: Record<string, any>;
  /**
   * Only commands that cannot write may run. Set by read-only modes for
   * terminal tools, where the arguments decide whether the call is safe.
   */
  readOnlyOnly?: boolean;
  /**
   * On an ask policy: a command the classifier proves non-writing is allowed,
   * and every other command keeps the ask. This is the default-mode Bash rule.
   */
  readOnlyAllow?: boolean;
  /**
   * Only documentation files may be modified. Set by planning modes, which
   * are allowed to produce plans and notes but must not touch code. The
   * arguments decide whether the call is safe.
   */
  docsOnly?: boolean;
  /**
   * A write that lands outside the workspace is escalated to the human even
   * where the policy allows the tool, because writing into another project or
   * into a home directory is a different decision than editing this one. A run
   * that cannot ask refuses it. The arguments decide where the bytes land.
   */
  workspaceOnly?: boolean;
}

export interface ToolPermissions {
  /** Array of permission policies that are evaluated in order */
  policies: ToolPermissionPolicy[];
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, any>;
  preview?: ToolCallPreview[];
}

export interface PermissionCheckResult {
  permission: PermissionPolicy;
  /** The policy that matched this tool call */
  matchedPolicy?: ToolPermissionPolicy;
  /** Why the call was refused, when the decision needs explaining. */
  reason?: string;
}
