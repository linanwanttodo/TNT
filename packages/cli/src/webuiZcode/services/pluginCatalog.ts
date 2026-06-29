import * as fs from "node:fs";
import * as path from "node:path";

import type {
  PluginsOverviewResult,
  ZCodePluginsDescribeResult,
  ZCodePluginsListResult,
  ZCodePluginsOverviewResult,
  ZCodePluginsReferenceCatalogResult,
} from "@zcode/shared";

import {
  getProjectSettingsPath,
  writeSettingsValue,
} from "../../config/settingsFiles.js";
import {
  getPluginCacheDirectory,
  getPluginSearchRoots,
  getPluginsDirectory,
} from "../../plugins/directories.js";
import { invalidatePluginCache } from "../../plugins/loader.js";
import {
  loadPluginAgents,
  loadPluginCommands,
  loadPluginMcpServers,
  loadPluginSkills,
} from "../../plugins/loaderContributions.js";
import {
  discoverInstalledPlugins,
  type LoadedPlugin,
} from "../../plugins/manifest.js";
import { parseMarketplaceManifest } from "../../plugins/marketplaceManager.js";
import {
  loadInstalledPlugins,
  loadKnownMarketplaces,
} from "../../plugins/marketplaceRegistry.js";
import type {
  MarketplaceManifest,
  MarketplacePluginEntry,
} from "../../plugins/marketplaceTypes.js";
import {
  configuredEnabledPlugins,
  ENABLED_PLUGINS_KEY,
  resolvePluginEnablement,
} from "../../plugins/pluginEnablement.js";

import { unavailable } from "./pluginErrors.js";
import {
  availableSummary,
  componentGroups,
  declaredMcpServerNames,
  diagnostic,
  installedSummary,
  legacyAvailableSummary,
  legacyInstalledSummary,
  legacyMarketplaceSummary,
  marketplaceOf,
  marketplaceSummary,
  pluginInfo,
  type Catalog,
  type PluginSummary,
  type PluginsSnapshot,
} from "./pluginMapping.js";

export function discoverPlugins(): Map<string, LoadedPlugin> {
  const byId = new Map<string, LoadedPlugin>();
  for (const plugin of discoverInstalledPlugins(getPluginSearchRoots())) {
    if (!byId.has(plugin.id)) byId.set(plugin.id, plugin);
  }
  return byId;
}

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
 * The loader's projection for one workspace. TNT's `services/webuiPlugins`
 * reads enablement from `process.cwd()`, which is right for a CLI process that
 * lives in its workspace but not for a host serving several. Building the
 * snapshot from `src/plugins` here keeps the enablement rooted in the
 * workspace handed to the RPC and keeps `webuiZcode` independent of
 * `services` (which already imports this host).
 */
export function snapshotPlugins(workspacePath: string): PluginsSnapshot {
  const installed = discoverInstalledPlugins(getPluginSearchRoots());
  const enablement = resolvePluginEnablement(
    installed.map((plugin) => plugin.name),
    configuredEnabledPlugins(workspacePath),
  );
  const enabledNames = new Set(enablement.enabled);
  const enabled = installed.filter((plugin) => enabledNames.has(plugin.name));
  const skills = loadPluginSkills(enabled);
  const commands = loadPluginCommands(enabled);
  const agents = loadPluginAgents(enabled);
  const mcpServers = loadPluginMcpServers(enabled);
  const ownerOfPath = (target: string): string =>
    installed.find((plugin) => isWithin(plugin.path, target))?.name ?? "";
  const plugins: PluginSummary[] = installed
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      path: plugin.path,
      enabled: enabledNames.has(plugin.name),
      skills: skills.filter((skill) => isWithin(plugin.path, skill.path))
        .length,
      commands: commands.filter((command) =>
        command.name.startsWith(`${plugin.name}:`),
      ).length,
      agents: agents.filter((agent) => agent.name.startsWith(`${plugin.name}:`))
        .length,
      mcpServers: mcpServerCount(plugin),
    }))
    .sort(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        left.name.localeCompare(right.name),
    );
  return {
    plugins,
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      plugin: ownerOfPath(skill.path),
      path: skill.path,
    })),
    commands: commands.map((command) => ({
      name: command.name,
      description: command.description,
      plugin: command.name.split(":")[0] ?? "",
    })),
    agents: agents.map((agent) => ({
      name: agent.name,
      description: agent.description ?? "",
      plugin: agent.name.split(":")[0] ?? "",
    })),
    mcpServers,
    disabledPlugins: installed
      .filter((plugin) => !enabledNames.has(plugin.name))
      .map((plugin) => plugin.name),
    unknownEnabledPlugins: enablement.unknown,
    marketplaces: Object.keys(loadKnownMarketplaces()).sort(),
    settingsPath: getProjectSettingsPath(workspacePath),
    pluginsDir: getPluginsDirectory(),
  };
}

export function reloadSnapshot(workspacePath: string): PluginsSnapshot {
  invalidatePluginCache();
  return snapshotPlugins(workspacePath);
}

export function persistPluginEnabled(
  name: string,
  enabled: boolean,
  workspacePath: string,
): PluginsSnapshot {
  const installed = discoverInstalledPlugins(getPluginSearchRoots());
  const target = installed.find(
    (plugin) => plugin.name === name || plugin.id === name,
  );
  if (!target) {
    throw new Error(`Plugin ${name} is not installed`);
  }
  const configured = configuredEnabledPlugins(workspacePath);
  if (enabled && configured === undefined) {
    return snapshotPlugins(workspacePath);
  }
  const current = configured ?? installed.map((plugin) => plugin.name);
  const next = enabled
    ? [...new Set([...current, target.name])]
    : current.filter((entry) => entry !== target.name && entry !== target.id);
  writeSettingsValue(
    getProjectSettingsPath(workspacePath),
    ENABLED_PLUGINS_KEY,
    next,
  );
  invalidatePluginCache();
  return snapshotPlugins(workspacePath);
}

export function readCatalogs(): Catalog[] {
  const known = loadKnownMarketplaces();
  return Object.keys(known)
    .sort()
    .map((name) => {
      const record = known[name];
      try {
        const manifest: MarketplaceManifest = parseMarketplaceManifest(
          JSON.parse(fs.readFileSync(record.installLocation, "utf-8")),
        );
        return { name, record, manifest };
      } catch (error) {
        return {
          name,
          record,
          failure: {
            code: "marketplace_unreadable",
            message: (error as Error).message,
          },
        };
      }
    });
}

export function catalogIndex(
  catalogs: Catalog[],
): Map<string, MarketplacePluginEntry> {
  const index = new Map<string, MarketplacePluginEntry>();
  for (const catalog of catalogs) {
    for (const entry of catalog.manifest?.plugins ?? []) {
      index.set(`${entry.name}@${catalog.name}`, entry);
    }
  }
  return index;
}

export function installedAtById(): Map<string, string> {
  try {
    const installed = loadInstalledPlugins();
    const result = new Map<string, string>();
    for (const [id, entries] of Object.entries(installed.plugins)) {
      const installedAt = entries[0]?.installedAt;
      if (installedAt) result.set(id, installedAt);
    }
    return result;
  } catch {
    return new Map();
  }
}

export function listCatalog(workspacePath: string): ZCodePluginsListResult {
  const snapshot = snapshotPlugins(workspacePath);
  const loaded = discoverPlugins();
  return {
    plugins: snapshot.plugins.map((plugin) =>
      pluginInfo(plugin, loaded.get(plugin.id), snapshot),
    ),
    diagnostics: [],
  };
}

export function overviewCatalog(
  workspacePath: string,
): ZCodePluginsOverviewResult {
  const snapshot = snapshotPlugins(workspacePath);
  const loaded = discoverPlugins();
  const catalogs = readCatalogs();
  const index = catalogIndex(catalogs);
  const installedIds = new Set(snapshot.plugins.map((plugin) => plugin.id));
  const installedAt = installedAtById();
  return {
    marketplaces: catalogs.map(marketplaceSummary),
    availablePlugins: catalogs.flatMap((catalog) =>
      (catalog.manifest?.plugins ?? []).map((entry) =>
        availableSummary(catalog.name, entry, installedIds),
      ),
    ),
    installedPlugins: snapshot.plugins.map((plugin) =>
      installedSummary(
        plugin,
        loaded.get(plugin.id),
        snapshot,
        index,
        installedAt.get(plugin.id),
      ),
    ),
    restorableBuiltins: [],
    diagnostics: catalogs.flatMap((catalog) =>
      catalog.failure
        ? [diagnostic(catalog.failure.code, catalog.failure.message, "warning")]
        : [],
    ),
    capability: { supported: true },
  };
}

export function legacyOverview(workspacePath: string): PluginsOverviewResult {
  const snapshot = snapshotPlugins(workspacePath);
  const loaded = discoverPlugins();
  const catalogs = readCatalogs();
  const installedIds = new Set(snapshot.plugins.map((plugin) => plugin.id));
  const installedAt = installedAtById();
  return {
    marketplaces: catalogs.map(legacyMarketplaceSummary),
    availablePlugins: catalogs.flatMap((catalog) =>
      (catalog.manifest?.plugins ?? []).map((entry) =>
        legacyAvailableSummary(catalog, entry, installedIds),
      ),
    ),
    installedPlugins: snapshot.plugins.map((plugin) =>
      legacyInstalledSummary(
        plugin,
        loaded.get(plugin.id),
        snapshot,
        installedAt.get(plugin.id),
      ),
    ),
    capability: { supported: true },
  };
}

export function referenceCatalog(
  workspacePath: string,
  sessionId: string | undefined,
  channelName: string,
): ZCodePluginsReferenceCatalogResult {
  if (sessionId) {
    unavailable(channelName);
  }
  const snapshot = snapshotPlugins(workspacePath);
  const loaded = discoverPlugins();
  const enabled = snapshot.plugins.filter((plugin) => plugin.enabled);
  const nameCounts = new Map<string, number>();
  for (const plugin of enabled) {
    nameCounts.set(plugin.name, (nameCounts.get(plugin.name) ?? 0) + 1);
  }
  return {
    authority: "workspace",
    plugins: snapshot.plugins.map((plugin) => {
      const loadedPlugin = loaded.get(plugin.id);
      const conflicting =
        plugin.enabled && (nameCounts.get(plugin.name) ?? 0) > 1
          ? enabled
              .filter(
                (candidate) =>
                  candidate.name === plugin.name && candidate.id !== plugin.id,
              )
              .map((candidate) => candidate.id)
          : [];
      return {
        pluginId: plugin.id,
        name: plugin.name,
        marketplace: marketplaceOf(plugin.id),
        ...(plugin.description ? { description: plugin.description } : {}),
        enabled: plugin.enabled,
        conflictingPluginIds: conflicting,
        skillQualifiedNames: loadedPlugin
          ? loadPluginSkills([loadedPlugin]).map(
              (skill) => `${plugin.name}:${skill.name}`,
            )
          : [],
        mcpServerNames: loadedPlugin
          ? declaredMcpServerNames(loadedPlugin)
          : [],
        subagentNames: loadedPlugin
          ? loadPluginAgents([loadedPlugin]).map((agent) => agent.name)
          : [],
      };
    }),
  };
}

export function describePluginFrom(params: {
  marketplace: string;
  pluginName: string;
}): ZCodePluginsDescribeResult {
  const id = `${params.pluginName}@${params.marketplace}`;
  const loaded = discoverPlugins().get(id);
  if (!loaded) {
    return {
      components: [],
      diagnostics: [
        diagnostic(
          "plugin_not_installed",
          `Plugin ${id} is not installed; only installed plugins can be described`,
          "error",
          id,
        ),
      ],
    };
  }
  const author = loaded.manifest.author;
  const metadata = {
    ...(author?.name ? { author: author.name } : {}),
    ...(author?.url ? { authorUrl: author.url } : {}),
    ...(loaded.manifest.homepage ? { homepage: loaded.manifest.homepage } : {}),
    ...(loaded.version ? { version: loaded.version } : {}),
  };
  return {
    components: componentGroups(loaded),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    diagnostics: [],
  };
}

export function catalogEntry(
  marketplace: string,
  pluginName: string,
): MarketplacePluginEntry {
  const record = loadKnownMarketplaces()[marketplace];
  if (!record) {
    throw new Error(`Marketplace ${marketplace} is not registered`);
  }
  const manifest = parseMarketplaceManifest(
    JSON.parse(fs.readFileSync(record.installLocation, "utf-8")),
  );
  const entry = manifest.plugins.find(
    (candidate) => candidate.name === pluginName,
  );
  if (!entry) {
    throw new Error(`Plugin ${pluginName} is not listed by ${marketplace}`);
  }
  return entry;
}

export function removePluginDirectory(pluginPath: string): void {
  const root = path.resolve(getPluginCacheDirectory());
  const target = path.resolve(pluginPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

export function pluginFromSnapshot(
  snapshot: PluginsSnapshot,
  pluginId: string,
): PluginSummary | undefined {
  return snapshot.plugins.find(
    (plugin) => plugin.id === pluginId || plugin.name === pluginId,
  );
}
