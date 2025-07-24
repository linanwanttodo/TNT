import { ToolCallPreview } from "../tools/types.js";

export type PermissionPolicy = "allow" | "ask" | "exclude";

export type PermissionMode = "agent" | "plan" | "auto";

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
