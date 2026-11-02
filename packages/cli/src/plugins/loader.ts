import * as fs from "fs";

import { getPluginSearchRoots } from "./directories.js";
import {
  loadPluginAgents,
  loadPluginCommands,
  loadPluginHooks,
  loadPluginMcpServers,
  loadPluginSkills,
  type PluginAgents,
  type PluginCommands,
  type PluginHooks,
  type PluginSkills,
} from "./loaderContributions.js";
import {
  type PluginLspServer,
  type PluginOutputStyle,
  loadPluginLspServers,
  loadPluginOutputStyles,
} from "./loaderOutputStyles.js";
import { type LoadedPlugin, discoverInstalledPlugins } from "./manifest.js";
import { applyPluginEnablement } from "./pluginEnablement.js";
import {
  mergePluginSettings,
  setPluginSettingsBase,
} from "./pluginSettings.js";

// The contribution loaders and their result types live beside the manifest they
// read; re-exports keep the import path every consumer and test already has.
export {
  readJson,
  expandListField,
  resolvePluginPath,
} from "./loaderContributions.js";
export type {
  PluginHooks,
  PluginCommands,
  PluginAgents,
  PluginSkills,
  PluginMcpServers,
} from "./loaderContributions.js";
export type {
  PluginOutputStyle,
  PluginLspServer,
} from "./loaderOutputStyles.js";
export { selectForcedOutputStyle } from "./loaderOutputStyles.js";

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  hooks: PluginHooks;
  commands: PluginCommands[];
  agents: PluginAgents[];
  skills: PluginSkills[];
  mcpServers: Record<string, unknown>;
  outputStyles: PluginOutputStyle[];
  lspServers: PluginLspServer[];
  /** Installed but not loaded, because the settings list does not name them. */
  disabledPlugins: string[];
  /** Names the settings list mentions that are not installed, so a typo shows. */
  unknownEnabledPlugins: string[];
}

/**
 * Marketplace names reserved by Claude Code. Registering a third-party
 * marketplace under one of these names is refused so plugin authors cannot
 * impersonate the official catalog.
 */
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "life-sciences",
  "knowledge-work-plugins",
]);

const RESERVED_NAME_PATTERN =
  /(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|^(?:anthropic|claude)[^a-z0-9]*(marketplace|plugins|official))/i;

/** Exact catalogue names that only the official source may claim. */
export function isReservedMarketplaceName(name: string): boolean {
  return RESERVED_MARKETPLACE_NAMES.has(name.toLowerCase());
}

export function isBlockedMarketplaceName(name: string): boolean {
  if (RESERVED_MARKETPLACE_NAMES.has(name.toLowerCase())) {
    return false;
  }
  if (/[^ -~]/.test(name)) {
    return true;
  }
  return RESERVED_NAME_PATTERN.test(name);
}

/**
 * Output style files. A plugin may ship a default output-styles directory and
 * any number of extra files or directories declared in its manifest; both are
 * read, matching Claude Code.
 */

/**
 * A style that a plugin forces is used without the user picking it. When more
 * than one plugin forces a style the first one wins, which is deterministic
 * because discovery order is.
 */

/**
 * Load every installed plugin and project it onto the subsystems TNT already
 * has. Failures are contained: a broken plugin is skipped and logged rather
 * than taking down startup.
 *
 * The result is memoized against a fingerprint of the plugin cache roots'
 * directory trees, because the call sites sit on the per-round critical path
 * (the system message's output style, the subagent roster, the hook table):
 * re-walking every plugin directory several times a round is wasted I/O.
 * Installing or uninstalling changes the fingerprint and triggers a reload;
 * `invalidatePluginCache` covers anything else that mutates plugin files.
 */
let pluginCache: { fingerprint: string; result: PluginLoadResult } | null =
  null;

function fingerprintSearchRoots(roots: string[]): string {
  const parts: string[] = [];
  for (const root of roots) {
    try {
      const stat = fs.statSync(root);
      parts.push(`${root}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${root}:missing`);
    }
  }
  return parts.join("|");
}

export function loadAllPlugins(): PluginLoadResult {
  const roots = getPluginSearchRoots();
  const fingerprint = fingerprintSearchRoots(roots);
  if (pluginCache && pluginCache.fingerprint === fingerprint) {
    return pluginCache.result;
  }

  const installed = discoverInstalledPlugins(roots);
  // Installing is not enabling: a settings list decides which of them may load.
  const { plugins, disabledPlugins, unknownEnabledPlugins } =
    applyPluginEnablement(installed);
  // Cache the settings layer for the synchronous readers (settingsFiles): a
  // plugin contributes defaults, below every settings file.
  setPluginSettingsBase(mergePluginSettings(plugins));

  const result: PluginLoadResult = {
    plugins,
    hooks: loadPluginHooks(plugins),
    commands: loadPluginCommands(plugins),
    agents: loadPluginAgents(plugins),
    skills: loadPluginSkills(plugins),
    mcpServers: loadPluginMcpServers(plugins),
    outputStyles: loadPluginOutputStyles(plugins),
    lspServers: loadPluginLspServers(plugins),
    disabledPlugins,
    unknownEnabledPlugins,
  };
  pluginCache = { fingerprint, result };
  return result;
}

/**
 * Drop the memoized plugin load, for callers that changed a plugin's files in
 * place (the fingerprint only watches the roots' directory entries).
 */
export function invalidatePluginCache(): void {
  pluginCache = null;
}
