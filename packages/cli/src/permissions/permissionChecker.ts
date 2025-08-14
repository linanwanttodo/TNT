import type { ToolPolicy } from "@tnt/terminal-security";

import { ALL_BUILT_IN_TOOLS } from "src/tools/allBuiltIns.js";

import {
  PermissionCheckResult,
  PermissionPolicy,
  ToolCallRequest,
  ToolPermissions,
} from "./types.js";
import { isDocumentPath } from "./documentPath.js";
import { isReadOnlyCommand } from "./readOnlyCommand.js";

/**
 * The message the model reads when a read-only mode refuses a command. It
 * names the mode so the model stops retrying and asks the user to switch,
 * instead of rewording the same write.
 */
export const READ_ONLY_MODE_DENIAL =
  "Blocked: this mode is read-only, and the command can modify the project. Ask the user to switch to agent mode to run it.";

/**
 * The message the model reads when a documentation-only mode refuses a write.
 * It names the accepted extensions so the model files its plan correctly
 * instead of renaming the same file and retrying.
 */
export const DOCUMENT_ONLY_MODE_DENIAL =
  "Blocked: this mode may only write documentation files (.md, .mdx, .markdown, .rst, .txt). Ask the user to switch to agent mode to change code.";

/**
 * Checks if a tool name matches a pattern.
 * Supports wildcards (*) for pattern matching.
 * Also handles special Bash command patterns like "Bash(ls*)"
 */
export function matchesToolPattern(
  toolName: string,
  pattern: string,
  toolArguments?: Record<string, any>,
): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;

  // Handle special Bash command patterns like "Bash(ls*)"
  const bashCommandMatch = pattern.match(/^Bash\((.+)\)$/);
  if (bashCommandMatch) {
    // Check if this is a bash/terminal tool
    const isBashTool = toolName === "Bash";
    if (isBashTool && toolArguments?.command) {
      const commandPattern = bashCommandMatch[1];
      const command = toolArguments.command;

      // Handle command patterns with wildcards
      if (commandPattern.includes("*") || commandPattern.includes("?")) {
        // Escape all regex metacharacters except * and ?
        const escaped = commandPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        // Convert * and ? to their regex equivalents
        const regexPattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(command);
      }

      // Exact command match
      return command === commandPattern;
    }
    return false;
  }

  // Handle regular wildcard patterns like "external_*"
  if (pattern.includes("*") || pattern.includes("?")) {
    // Escape all regex metacharacters except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    // Convert * and ? to their regex equivalents
    const regexPattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(toolName);
  }

  return false;
}

/**
 * Checks if tool call arguments match the specified patterns.
 * Supports glob patterns with * and ? wildcards.
 */
export function matchesArguments(
  args: Record<string, any>,
  patterns?: Record<string, any>,
): boolean {
  if (!patterns) return true;

  for (const [key, pattern] of Object.entries(patterns)) {
    const argValue = args[key];

    if (pattern === "*") continue; // Wildcard matches anything

    // Handle glob patterns with wildcards (only for string patterns)
    if (
      typeof pattern === "string" &&
      (pattern.includes("*") || pattern.includes("?"))
    ) {
      // Convert argValue to string for pattern matching
      const stringValue = String(argValue ?? "");

      // Escape all regex metacharacters except * and ?
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      // Convert * and ? to their regex equivalents
      const regexPattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
      const regex = new RegExp(`^${regexPattern}$`);

      if (!regex.test(stringValue)) {
        return false;
      }
    } else {
      // Exact match for non-glob patterns (preserve original behavior)
      if (argValue !== pattern) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Converts CLI's PermissionPolicy to core's ToolPolicy
 */
function permissionPolicyToToolPolicy(
  permission: PermissionPolicy,
): ToolPolicy {
  switch (permission) {
    case "allow":
      return "allowedWithoutPermission";
    case "ask":
      return "allowedWithPermission";
    case "exclude":
      return "disabled";
    default:
      return "allowedWithPermission";
  }
}

/**
 * Evaluates a tool call request against a set of permission policies.
 * Returns the permission for the first matching policy.
 */
export function checkToolPermission(
  toolCall: ToolCallRequest,
  permissions: ToolPermissions,
): PermissionCheckResult {
  const policies = permissions.policies;

  // The FIRST matching policy wins, which is what makes an allow-all override
  // work: listing the star rule first lets it beat every rule below it. Callers
  // that append a star last therefore get a fallback, not an override.
  let basePermission: PermissionPolicy = "ask";
  let matchedPolicy = undefined;

  for (const policy of policies) {
    if (
      matchesToolPattern(toolCall.name, policy.tool, toolCall.arguments) &&
      matchesArguments(toolCall.arguments, policy.argumentMatches)
    ) {
      basePermission = policy.permission;
      matchedPolicy = policy;
      break;
    }
  }

  // A documentation-only policy narrows "allow" to the files a planning
  // session may touch. A tool listing probe carries no path, and refusing
  // there would drop the tool from the request, so only a real call is judged.
  if (matchedPolicy?.docsOnly) {
    const filePath =
      toolCall.arguments?.filepath ?? toolCall.arguments?.file_path;
    const hasArguments =
      typeof toolCall.arguments === "object" &&
      toolCall.arguments !== null &&
      Object.keys(toolCall.arguments).length > 0;

    // A real call must name a documentation file. An argument shape that
    // carries no recognisable path is refused rather than assumed harmless.
    if (hasArguments && !isDocumentPath(filePath)) {
      return {
        permission: "exclude",
        matchedPolicy,
        reason: DOCUMENT_ONLY_MODE_DENIAL,
      };
    }
  }

  // Check if tool has dynamic policy evaluation
  const tool = ALL_BUILT_IN_TOOLS.find((t) => t.name === toolCall.name);
  if (tool?.evaluateToolCallPolicy) {
    // Convert CLI permission to core policy
    const basePolicy = permissionPolicyToToolPolicy(basePermission);

    // Evaluate the dynamic policy
    const evaluatedPolicy = tool.evaluateToolCallPolicy(
      basePolicy,
      toolCall.arguments,
    );

    // If dynamic evaluation says disabled, that ALWAYS takes precedence
    if (evaluatedPolicy === "disabled") {
      return {
        permission: "exclude",
        matchedPolicy,
      };
    }

    // A read-only policy narrows "allow" to commands that cannot write. The
    // tool listing probe carries no command, and refusing there would drop the
    // tool from the request, so only a real call is judged.
    if (matchedPolicy?.readOnlyOnly) {
      const command = toolCall.arguments?.command;
      if (
        typeof command === "string" &&
        command.trim() !== "" &&
        !isReadOnlyCommand(command)
      ) {
        return {
          permission: "exclude",
          matchedPolicy,
          reason: READ_ONLY_MODE_DENIAL,
        };
      }
    }

    // Otherwise, user preference wins - return the original base permission
    return {
      permission: basePermission,
      matchedPolicy,
    };
  }

  // No dynamic evaluation, return static result
  return {
    permission: basePermission,
    matchedPolicy,
  };
}
