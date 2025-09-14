import { readSettingsStringArray } from "../config/settingsFiles.js";
import { logger } from "../utils/logger.js";

/**
 * Installing a plugin is not enabling it.
 *
 * A settings file that names the plugins allowed to load makes everything else
 * installed and idle, which is what lets a user try a plugin without uninstalling
 * it later, and what makes a marketplace install safe to perform before reading
 * what the plugin declares. No list at all means every installed plugin loads -
 * the behaviour configurations written before this key expect - so the key is
 * only a restriction once someone writes it.
 */
export const ENABLED_PLUGINS_KEY = "enabledPlugins";

export interface PluginEnablement {
  /** Installed plugins that may load, in the order they were discovered. */
  enabled: string[];
  /** Installed but not named by the list: present on disk, not loaded. */
  disabled: string[];
  /** Names the list mentions that are not installed, so a typo is visible. */
  unknown: string[];
}

export function resolvePluginEnablement(
  installedIds: readonly string[],
  configured: readonly string[] | undefined,
): PluginEnablement {
  if (configured === undefined) {
    return { enabled: [...installedIds], disabled: [], unknown: [] };
  }

  const wanted = new Set(configured);
  const enabled = installedIds.filter((id) => wanted.has(id));
  const disabled = installedIds.filter((id) => !wanted.has(id));
  const installedSet = new Set(installedIds);
  const unknown = configured.filter((id) => !installedSet.has(id));

  return { enabled, disabled, unknown };
}

/**
 * What the settings files say. Read per call rather than cached: a user editing
 * the list mid-session expects the next reload to see it.
 */
export function configuredEnabledPlugins(
  cwd: string = process.cwd(),
  homeDir?: string,
): string[] | undefined {
  const configured = readSettingsStringArray(ENABLED_PLUGINS_KEY, cwd, homeDir);
  if (configured !== undefined) {
    logger.debug("Plugins restricted by settings", {
      enabledPlugins: configured,
    });
  }
  return configured;
}
