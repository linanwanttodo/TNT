import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { env } from "../config/env.js";

/**
 * Plugin storage layout, mirroring the Claude Code layout so an existing
 * ~/.claude/plugins tree can be mirrored into TNT without rewriting paths.
 *
 * ~/.tnt/plugins/
 *   known_marketplaces.json
 *   installed_plugins.json
 *   marketplaces/<name>/
 *   cache/<marketplace>/<plugin>/<version>/
 *   data/<plugin-id>/
 */
export function getPluginsDirectory(): string {
  // Names the plugins tree, which contains cache/, data/ and the registries.
  // Pointing it at a cache directory would nest one inside the other.
  const override = process.env.TNT_PLUGINS_DIR;
  if (override) {
    return expandTilde(override);
  }
  return path.join(env.continueHome, "plugins");
}

export function expandTilde(value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

export function getKnownMarketplacesPath(): string {
  return path.join(getPluginsDirectory(), "known_marketplaces.json");
}

export function getInstalledPluginsPath(): string {
  return path.join(getPluginsDirectory(), "installed_plugins.json");
}

export function getMarketplacesDirectory(): string {
  return path.join(getPluginsDirectory(), "marketplaces");
}

export function getPluginCacheDirectory(): string {
  return path.join(getPluginsDirectory(), "cache");
}

function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/[^a-zA-Z0-9\-_]/g, "-");
}

export function getPluginDataDir(pluginId: string): string {
  const dir = path.join(
    getPluginsDirectory(),
    "data",
    sanitizePluginId(pluginId),
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Every directory that may hold installed plugins. TNT's own tree comes
 * first; the Claude Code tree is read as a migration source so users who
 * already installed plugins elsewhere keep working.
 */
export function getPluginSearchRoots(): string[] {
  const roots = [getPluginCacheDirectory()];
  const claudePlugins = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(claudePlugins)) {
    roots.push(claudePlugins);
  }
  return roots;
}
