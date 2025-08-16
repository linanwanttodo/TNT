/**
 * Hook configuration loader.
 *
 * Loads hooks from settings files in the same locations as Claude Code:
 * - ~/.tnt/settings.json  (user-global)
 * - .tnt/settings.json    (project, committable)
 * - .tnt/settings.local.json (project-local, gitignored)
 *
 * Also supports Claude Code's native locations for cross-compatibility:
 * - ~/.claude/settings.json
 * - .claude/settings.json
 * - .claude/settings.local.json
 *
 * Hooks from all sources are merged (project > user, continue > claude).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getSettingsFilePaths } from "../config/settingsFiles.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { logger } from "../utils/logger.js";

import type {
  HookMatcherGroup,
  HookSettingsFile,
  HooksConfig,
} from "./types.js";

/**
 * Load and parse a settings JSON file, returning only the hooks portion.
 * Returns null if file doesn't exist or fails to parse.
 */
function loadSettingsFile(filePath: string): HookSettingsFile | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed as HookSettingsFile;
  } catch (error) {
    logger.warn(`Failed to load hooks settings from ${filePath}:`, error);
    return null;
  }
}

/**
 * Merge two hook configs. Later config entries are appended (not replaced).
 * This matches Claude Code's behavior: hooks from multiple sources all run.
 */
function mergeHooksConfigs(
  base: HooksConfig,
  overlay: HooksConfig,
): HooksConfig {
  const merged: HooksConfig = { ...base };

  for (const [eventName, matcherGroups] of Object.entries(overlay)) {
    const key = eventName as keyof HooksConfig;
    if (merged[key]) {
      merged[key] = [...merged[key]!, ...matcherGroups!];
    } else {
      merged[key] = matcherGroups;
    }
  }

  return merged;
}

export interface LoadedHooksConfig {
  hooks: HooksConfig;
  disabled: boolean;
}

/**
 * Load all hook configurations from settings files and merge them.
 */
export function loadHooksConfig(
  cwd: string = process.cwd(),
  homeDir?: string,
): LoadedHooksConfig {
  const paths = getSettingsFilePaths(cwd, homeDir);
  let mergedHooks: HooksConfig = {};
  let disabled = false;

  for (const filePath of paths) {
    const settings = loadSettingsFile(filePath);
    if (!settings) continue;

    if (settings.disableAllHooks) {
      disabled = true;
    }

    if (settings.hooks) {
      mergedHooks = mergeHooksConfigs(mergedHooks, settings.hooks);
    }
  }

  // Plugins contribute hooks last so settings stay authoritative for ordering
  // of the built-in sources, while plugin hooks still all run.
  try {
    const plugins = loadAllPlugins();
    if (plugins.hooks.disabled) {
      disabled = true;
    }
    mergedHooks = mergeHooksConfigs(mergedHooks, plugins.hooks.config);
  } catch (error) {
    logger.warn("Failed to load plugin hooks:", error);
  }

  return { hooks: mergedHooks, disabled };
}

/**
 * Get matching hook handlers for a given event and matcher value.
 *
 * @param config - The merged hooks config
 * @param eventName - The hook event name
 * @param matcherValue - The value to match against (e.g., tool name). Undefined for events without matchers.
 * @returns Array of matching hook handler groups
 */
export function getMatchingHookGroups(
  config: HooksConfig,
  eventName: string,
  matcherValue?: string,
): HookMatcherGroup[] {
  const groups = config[eventName as keyof HooksConfig];
  if (!groups) return [];

  return groups.filter((group) => {
    // No matcher, empty matcher, or "*" = match all
    if (!group.matcher || group.matcher === "" || group.matcher === "*") {
      return true;
    }

    // If no matcher value provided (e.g., events without matcher support), match all
    if (matcherValue === undefined) {
      return true;
    }

    // Regex match
    try {
      const regex = new RegExp(group.matcher);
      return regex.test(matcherValue);
    } catch (error) {
      logger.warn(
        `Invalid hook matcher regex "${group.matcher}" for event ${eventName}:`,
        error,
      );
      return false;
    }
  });
}
