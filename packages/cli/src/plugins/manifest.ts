import * as fs from "fs";
import * as path from "path";

import { getPluginDataDir } from "./directories.js";

export interface PluginAuthor {
  name?: string;
  email?: string;
  url?: string;
}

export interface PluginCommand {
  name: string;
  description?: string;
  /** Argument hint shown in the command palette. */
  argumentHint?: string;
}

/**
 * The subset of the Claude Code plugin manifest (plugin.json) that TNT can
 * consume. Unknown fields are ignored rather than rejected, so manifests
 * written for Claude Code load unchanged.
 */
export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  commands?: string[] | string;
  agents?: string[] | string;
  skills?: string[] | string;
  hooks?: string | unknown;
  mcpServers?: Record<string, unknown> | string;
  outputStyles?: string[] | string;
  lspServers?:
    | string
    | string[]
    | Record<string, unknown>
    | Array<string | Record<string, unknown>>;
  settings?: Record<string, unknown>;
}

export interface LoadedPlugin {
  /** Stable id: "name@marketplace" when known, otherwise the bare name. */
  id: string;
  name: string;
  /** Absolute path to the plugin root, exposed as ${CLAUDE_PLUGIN_ROOT}. */
  path: string;
  version?: string;
  description?: string;
  manifest: PluginManifest;
}

/**
 * Substitute the variables Claude Code exposes to plugin scripts. Both are
 * substituted lazily because creating the data directory has a side effect
 * that should not happen for plugins that never reference it.
 */
export function substitutePluginVariables(
  value: string,
  plugin: LoadedPlugin,
): string {
  return value
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, plugin.path)
    .replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, () => getPluginDataDir(plugin.id));
}

function parseManifest(
  filePath: string,
  pluginRoot: string,
  marketplace?: string,
): LoadedPlugin | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const manifest = JSON.parse(raw) as PluginManifest;
    if (!manifest?.name || typeof manifest.name !== "string") {
      return null;
    }
    return {
      id: marketplace ? `${manifest.name}@${marketplace}` : manifest.name,
      name: manifest.name,
      path: pluginRoot,
      version: manifest.version,
      description: manifest.description,
      manifest,
    };
  } catch {
    return null;
  }
}

/**
 * Read a plugin root that directly contains .claude-plugin/plugin.json or
 * plugin.json.
 */
export function loadPluginFromDirectory(
  pluginRoot: string,
  marketplace?: string,
): LoadedPlugin | null {
  const candidates = [
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    path.join(pluginRoot, "plugin.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const plugin = parseManifest(candidate, pluginRoot, marketplace);
    if (plugin) return plugin;
  }

  return null;
}

/**
 * Discover installed plugins under the cache roots. Layout is
 * cache/<marketplace>/<plugin>/<version>/, and the newest version directory
 * by name wins so an update takes effect on the next load.
 */
export function discoverInstalledPlugins(cacheRoots: string[]): LoadedPlugin[] {
  const plugins: LoadedPlugin[] = [];
  const seen = new Set<string>();

  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;

    for (const marketplace of safeReadDir(root)) {
      const marketplaceDir = path.join(root, marketplace);
      if (!isDirectory(marketplaceDir)) continue;

      for (const pluginName of safeReadDir(marketplaceDir)) {
        const pluginDir = path.join(marketplaceDir, pluginName);
        if (!isDirectory(pluginDir)) continue;

        const version = safeReadDir(pluginDir)
          .filter((entry) => isDirectory(path.join(pluginDir, entry)))
          .sort()
          .at(-1);
        if (!version) continue;

        const pluginRoot = path.join(pluginDir, version);
        const plugin = loadPluginFromDirectory(pluginRoot, marketplace);
        if (!plugin || seen.has(plugin.id)) continue;

        seen.add(plugin.id);
        plugins.push(plugin);
      }
    }
  }

  return plugins;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(target: string): string[] {
  try {
    return fs.readdirSync(target);
  } catch {
    return [];
  }
}
