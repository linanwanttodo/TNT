import fs from "fs";

import YAML from "yaml";

import { logger } from "../utils/logger.js";

import {
  PERMISSIONS_YAML_PATH,
  PermissionsYamlConfig,
  loadPermissionsYaml,
} from "./permissionsYamlLoader.js";
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
 * Adds a policy rule to the permissions.yaml file
 */
export async function addPolicyToYaml(policyRule: string): Promise<void> {
  try {
    // Load existing config or create empty one
    const config: PermissionsYamlConfig = loadPermissionsYaml() || {};

    // Ensure allow array exists
    if (!config.allow) {
      config.allow = [];
    }

    // Add the policy if it doesn't already exist
    if (config.allow.includes(policyRule)) {
      logger.debug(`Policy rule already exists: ${policyRule}`);
    } else {
      config.allow.push(policyRule);

      // Write the updated config back to the file
      const yamlContent = YAML.stringify(config);

      // Add header comment
      const finalContent = `# TNT Permissions Configuration
# This file is managed by the TNT and should not be edited manually.
# Use the TUI to modify permissions interactively.

${yamlContent}`;

      await fs.promises.writeFile(PERMISSIONS_YAML_PATH, finalContent, "utf-8");
      logger.info(`Added policy rule to permissions.yaml: ${policyRule}`);
    }
  } catch (error) {
    logger.error("Failed to add policy to permissions.yaml", {
      error,
      policyRule,
    });
    throw error;
  }
}
