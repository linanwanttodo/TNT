import path from "path";

import {
  getProjectSettingsPath,
  writeSettingsValue,
} from "../config/settingsFiles.js";
import {
  getPluginSearchRoots,
  getPluginsDirectory,
} from "../plugins/directories.js";
import {
  configuredEnabledPlugins,
  ENABLED_PLUGINS_KEY,
} from "../plugins/pluginEnablement.js";
import { invalidatePluginCache, loadAllPlugins } from "../plugins/loader.js";
import { loadKnownMarketplaces } from "../plugins/marketplaceRegistry.js";
import {
  discoverInstalledPlugins,
  type LoadedPlugin,
} from "../plugins/manifest.js";

export interface PluginSummary {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Absolute plugin root; the page can reveal or copy it. */
  path: string;
  enabled: boolean;
  skills: number;
  commands: number;
  agents: number;
  mcpServers: number;
}

export interface PluginContribution {
  name: string;
  description: string;
  plugin: string;
  path?: string;
}

/** Everything the Customize page needs, in one response. */
export interface PluginsSnapshot {
  plugins: PluginSummary[];
  skills: PluginContribution[];
  commands: PluginContribution[];
  agents: PluginContribution[];
  mcpServers: Record<string, unknown>;
  disabledPlugins: string[];
  unknownEnabledPlugins: string[];
  marketplaces: string[];
  /** The settings file enable/disable writes to for this project. */
  settingsPath: string;
  /** The installed-plugin tree the page can reveal. */
  pluginsDir: string;
}

/** True when `target` is the plugin root or lives under it. */
function isWithin(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function mcpServerCount(plugin: LoadedPlugin): number {
  const value = plugin.manifest.mcpServers;
  if (value === undefined) return 0;
  if (typeof value === "string") return 1;
  return Object.keys(value).length;
}

/**
 * The installed plugins and what each contributes. Disabled plugins are
 * included so the page can show what is installed but not loaded; the
 * contribution lists stay scoped to enabled plugins, matching the runtime.
 */
export function listInstalledPlugins(
  cwd: string = process.cwd(),
): PluginsSnapshot {
  const loaded = loadAllPlugins();
  const installed = discoverInstalledPlugins(getPluginSearchRoots());
  const enabledIds = new Set(loaded.plugins.map((plugin) => plugin.id));

  const ownerOfPath = (target: string): string =>
    installed.find((plugin) => isWithin(plugin.path, target))?.name ?? "";

  const plugins: PluginSummary[] = installed
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      path: plugin.path,
      enabled: enabledIds.has(plugin.id),
      skills: loaded.skills.filter((skill) => isWithin(plugin.path, skill.path))
        .length,
      commands: loaded.commands.filter((command) =>
        command.name.startsWith(`${plugin.name}:`),
      ).length,
      agents: loaded.agents.filter((agent) =>
        agent.name.startsWith(`${plugin.name}:`),
      ).length,
      mcpServers: mcpServerCount(plugin),
    }))
    .sort(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        left.name.localeCompare(right.name),
    );

  const settingsPath = getProjectSettingsPath(cwd);
  return {
    plugins,
    skills: loaded.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      plugin: ownerOfPath(skill.path),
      path: skill.path,
    })),
    commands: loaded.commands.map((command) => ({
      name: command.name,
      description: command.description,
      plugin: command.name.split(":")[0] ?? "",
    })),
    agents: loaded.agents.map((agent) => ({
      name: agent.name,
      description: agent.description ?? "",
      plugin: agent.name.split(":")[0] ?? "",
    })),
    mcpServers: loaded.mcpServers,
    disabledPlugins: installed
      .filter((plugin) => !enabledIds.has(plugin.id))
      .map((plugin) => plugin.name),
    unknownEnabledPlugins: loaded.unknownEnabledPlugins,
    marketplaces: Object.keys(loadKnownMarketplaces()).sort(),
    settingsPath,
    pluginsDir: getPluginsDirectory(),
  };
}

/**
 * Enable or disable one installed plugin by writing the project's
 * `enabledPlugins` list. No list means every installed plugin loads, so
 * disabling one materializes the current set first; disabling never drops
 * unknown names a user put in the file.
 */
export function setPluginEnabled(
  name: string,
  enabled: boolean,
  cwd: string = process.cwd(),
): PluginsSnapshot {
  const installed = discoverInstalledPlugins(getPluginSearchRoots());
  const target = installed.find(
    (plugin) => plugin.name === name || plugin.id === name,
  );
  if (!target) {
    throw new Error(`plugin not installed: ${name}`);
  }

  const configured = configuredEnabledPlugins(cwd);
  if (enabled && configured === undefined) {
    return listInstalledPlugins(cwd);
  }

  const current = configured ?? installed.map((plugin) => plugin.name);
  const next = enabled
    ? [...new Set([...current, target.name])]
    : current.filter((entry) => entry !== target.name && entry !== target.id);

  writeSettingsValue(getProjectSettingsPath(cwd), ENABLED_PLUGINS_KEY, next);
  invalidatePluginCache();
  return listInstalledPlugins(cwd);
}

/** Drop the loader's memo and re-read the plugin tree. */
export function reloadPlugins(cwd: string = process.cwd()): PluginsSnapshot {
  invalidatePluginCache();
  return listInstalledPlugins(cwd);
}
