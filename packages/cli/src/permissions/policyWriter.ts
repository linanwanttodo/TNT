import { writeFileAtomically } from "core/util/atomicWrite.js";
import YAML from "yaml";

import { logger } from "../utils/logger.js";

import { commandSegments, isCommandRiskyAlone } from "./bashCommandRule.js";
import {
  PermissionsYamlConfig,
  loadPermissionsYaml,
  permissionsYamlPath,
} from "./permissionsYamlLoader.js";
import { withPermissionWriteLock } from "./permissionWriteLock.js";

const PERMISSIONS_HEADER = `# TNT Permissions Configuration
# This file is managed by the TNT and should not be edited manually.
# Use the TUI to modify permissions interactively.

`;

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
 * Adds a policy rule to the permissions.yaml file.
 *
 * The read-modify-write runs under a lock file and the write replaces the file
 * atomically: two sessions granting a permanent rule at the same moment used
 * to lose one of them, and a crash mid-write left a half-parsed file through
 * which every rule on it disappeared for the session that read it.
 */
export async function addPolicyToYaml(policyRule: string): Promise<void> {
  try {
    const filePath = permissionsYamlPath();
    await withPermissionWriteLock(`${filePath}.lock`, async () => {
      // Read inside the lock: another writer may have appended a rule between
      // this approval being granted and its write landing.
      const config: PermissionsYamlConfig = loadPermissionsYaml() || {};
      const allow = config.allow ?? [];
      if (allow.includes(policyRule)) {
        logger.debug(`Policy rule already exists: ${policyRule}`);
        return;
      }
      const yamlContent = YAML.stringify({
        ...config,
        allow: [...allow, policyRule],
      });
      writeFileAtomically(filePath, `${PERMISSIONS_HEADER}${yamlContent}`);
      logger.info(`Added policy rule to permissions.yaml: ${policyRule}`);
    });
  } catch (error) {
    logger.error("Failed to add policy to permissions.yaml", {
      error,
      policyRule,
    });
    throw error;
  }
}
