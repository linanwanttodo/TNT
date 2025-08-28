import { logger } from "../utils/logger.js";

/**
 * The settings keys a plugin manifest may contribute to the settings
 * cascade. Deliberately tiny: a key only belongs here once something in the
 * CLI reads it from the settings, and every entry widens what an installed
 * plugin can change about a session.
 */
export const PLUGIN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "outputStyle",
]);

interface SettingsContributor {
  name: string;
  manifest: { settings?: Record<string, unknown> };
}

let base: Record<string, unknown> | undefined;

/**
 * Merges the settings every loaded plugin declares into one record - a later
 * plugin wins per key - keeping only allowlisted keys. The result is the
 * lowest layer of the settings cascade: every settings file overrides it, so
 * a plugin ships defaults, never decisions.
 */
export function mergePluginSettings(
  plugins: SettingsContributor[],
): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;
  // Name order, so which plugin wins does not depend on directory listing
  // order: the later name wins, like the later file wins in a merge of files.
  const ordered = [...plugins].sort((a, b) => a.name.localeCompare(b.name));
  for (const plugin of ordered) {
    const declared = plugin.manifest.settings;
    if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
      continue;
    }
    for (const [key, value] of Object.entries(declared)) {
      if (!PLUGIN_SETTINGS_KEYS.has(key)) {
        continue;
      }
      if (!merged) {
        merged = {};
      }
      if (key in merged) {
        logger.debug(
          `Plugin "${plugin.name}" overrides the "${key}" setting another plugin declared`,
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}

/** Called by the plugin loader once the installed plugins are known. */
export function setPluginSettingsBase(
  settings: Record<string, unknown> | undefined,
): void {
  base = settings;
}

/** The cached lowest settings layer, for the synchronous settings readers. */
export function getPluginSettingsBase(): Record<string, unknown> | undefined {
  return base;
}
