import { addSettingsPolicyRule } from "../config/settings.js";

import { commandSegments, isCommandRiskyAlone } from "./bashCommandRule.js";

/**
 * Generates a policy rule for a given tool call
 * For most tools, returns the display name (e.g., "Read", "Write")
 * For Bash tool, generates command-specific patterns like "Bash(ls*)"
 */
export function generatePolicyRule(toolName: string, toolArgs: any): string {
  const normalizedName = toolName;

  // For Bash tool, create command-specific policies
  if (normalizedName === "Bash" && toolArgs?.command) {
    const command = toolArgs.command.trim();
    const segments = commandSegments(command);
    if (segments.length === 0) {
      return normalizedName;
    }
    // A chain was approved as the line the user read, not as its first command
    // with any tail: the old rule wrote `git add . && rm -rf /` as Bash(git*),
    // which then approved every git command forever.
    if (segments.length > 1) {
      return `Bash(${command})`;
    }
    // The same reasoning holds for one command that can do more than its name
    // says, because a shape rule matches exactly the part that varies. Writing
    // `Bash(git*)` for an approved `git push` would also approve `git reset`.
    if (isCommandRiskyAlone(segments[0])) {
      return `Bash(${command})`;
    }
    // Extract just the command name (before spaces or flags)
    const commandName = segments[0].split(/\s+/)[0];
    return `Bash(${commandName}*)`;
  }

  // For all other tools, return the display name
  return normalizedName;
}

/**
 * Adds a permanent allow rule to settings.json permissions.allow.
 *
 * settings.json is the only file this writes; permissions.yaml is read-only
 * legacy input. The lock and atomic write live in the settings module.
 */
export async function addPolicyRule(policyRule: string): Promise<void> {
  await addSettingsPolicyRule(policyRule);
}
