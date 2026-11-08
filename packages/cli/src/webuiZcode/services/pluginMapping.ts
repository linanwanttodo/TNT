import type {
  AvailablePluginSummary,
  InstalledPluginSummary,
  PluginComponentType,
  PluginMarketplaceSummary,
  ZCodeAvailablePluginSummary,
  ZCodeInstalledPluginSummary,
  ZCodePluginDiagnostic,
  ZCodePluginInfo,
  ZCodePluginMarketplaceSummary,
  ZCodePluginStoreListing,
} from "@zcode/shared";

import {
  loadPluginAgents,
  loadPluginCommands,
  loadPluginMcpServers,
  loadPluginSkills,
} from "../../plugins/loaderContributions.js";
import type { LoadedPlugin } from "../../plugins/manifest.js";
import type {
  KnownMarketplace,
  MarketplaceManifest,
  MarketplacePluginEntry,
} from "../../plugins/marketplaceTypes.js";

export interface Catalog {
  name: string;
  record: KnownMarketplace;
  manifest?: MarketplaceManifest;
  failure?: { code: string; message: string };
}

/** The projection the loader gives the plugin pages, built from `src/plugins`. */
export interface PluginSummary {
  id: string;
  name: string;
  version?: string;
  description?: string;
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

export interface PluginsSnapshot {
  plugins: PluginSummary[];
  skills: PluginContribution[];
  commands: PluginContribution[];
  agents: PluginContribution[];
  mcpServers: Record<string, unknown>;
  disabledPlugins: string[];
  unknownEnabledPlugins: string[];
  marketplaces: string[];
  settingsPath: string;
  pluginsDir: string;
}

type ComponentGroup = NonNullable<ZCodePluginInfo["components"]>[number];
type ComponentItem = ComponentGroup["items"][number];

export interface PluginCounts {
  skills: number;
  commands: number;
  agents: number;
  mcpServers: number;
}

export const OFFICIAL_MARKETPLACE_NAMES = new Set([
  "claude-plugins-official",
  "zcode-plugins-official",
]);

export function diagnostic(
  code: string,
  message: string,
  severity: "warning" | "error" = "error",
  pluginId?: string,
): ZCodePluginDiagnostic {
  return { code, message, severity, ...(pluginId ? { pluginId } : {}) };
}

export function marketplaceOf(id: string, fallback = "local"): string {
  const at = id.lastIndexOf("@");
  return at > 0 && at < id.length - 1 ? id.slice(at + 1) : fallback;
}

export function splitPluginId(
  id: string,
  fallbackMarketplace = "local",
): { name: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  if (at > 0 && at < id.length - 1) {
    return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
  }
  return { name: id, marketplace: fallbackMarketplace };
}

function toListing(
  entry: MarketplacePluginEntry,
): ZCodePluginStoreListing | undefined {
  const listing: ZCodePluginStoreListing = {};
  if (entry.category) listing.category = entry.category;
  if (entry.author?.name) listing.author = entry.author.name;
  if (entry.author?.url) listing.authorUrl = entry.author.url;
  return Object.keys(listing).length > 0 ? listing : undefined;
}

export function declaredMcpServerNames(plugin: LoadedPlugin): string[] {
  const prefix = `${plugin.name}-`;
  return Object.keys(loadPluginMcpServers([plugin])).map((key) =>
    key.startsWith(prefix) ? key.slice(prefix.length) : key,
  );
}

export function countsFor(
  snapshot: PluginsSnapshot,
  plugin: PluginSummary,
): PluginCounts {
  return {
    skills: snapshot.skills.filter((skill) => skill.plugin === plugin.name)
      .length,
    commands: snapshot.commands.filter(
      (command) => command.plugin === plugin.name,
    ).length,
    agents: snapshot.agents.filter((agent) => agent.plugin === plugin.name)
      .length,
    mcpServers: plugin.mcpServers,
  };
}

export function componentTypes(
  plugin: LoadedPlugin,
  counts: PluginCounts,
): PluginComponentType[] {
  const types: PluginComponentType[] = [];
  if (counts.skills > 0) types.push("skill");
  if (counts.commands > 0) types.push("command");
  if (counts.agents > 0) types.push("agent");
  if (counts.mcpServers > 0) types.push("mcp");
  if (plugin.manifest.hooks) types.push("hook");
  if (plugin.manifest.lspServers) types.push("lsp");
  return types;
}

function componentItem(
  name: string,
  description?: string,
): ComponentItem | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { name: trimmed, ...(description ? { description } : {}) };
}

export function componentGroups(plugin: LoadedPlugin): ComponentGroup[] {
  const stripPluginPrefix = (name: string): string =>
    name.startsWith(`${plugin.name}:`)
      ? name.slice(plugin.name.length + 1)
      : name;
  const collect = (
    kind: ComponentGroup["kind"],
    items: Array<ComponentItem | null>,
  ): ComponentGroup | null => {
    const present = items.filter(
      (item): item is ComponentItem => item !== null,
    );
    return present.length > 0 ? { kind, items: present } : null;
  };
  return [
    collect(
      "agent",
      loadPluginAgents([plugin]).map((agent) =>
        componentItem(stripPluginPrefix(agent.name), agent.description),
      ),
    ),
    collect(
      "command",
      loadPluginCommands([plugin]).map((command) =>
        componentItem(stripPluginPrefix(command.name), command.description),
      ),
    ),
    collect(
      "skill",
      loadPluginSkills([plugin]).map((skill) =>
        componentItem(skill.name, skill.description),
      ),
    ),
    collect(
      "mcp",
      declaredMcpServerNames(plugin).map((name) => componentItem(name)),
    ),
  ].filter((group): group is ComponentGroup => group !== null);
}

export function pluginInfo(
  plugin: PluginSummary,
  loaded: LoadedPlugin | undefined,
  snapshot: PluginsSnapshot,
): ZCodePluginInfo {
  const declared = loaded ? declaredMcpServerNames(loaded) : [];
  const counts = countsFor(snapshot, plugin);
  const components = loaded ? componentGroups(loaded) : [];
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    source: "cache",
    marketplace: marketplaceOf(plugin.id),
    skillCount: counts.skills,
    skillRootCount: counts.skills,
    commandRootCount: counts.commands,
    ...(components.length > 0 ? { components } : {}),
    ...(declared.length > 0 ? { declaredMcpServerNames: declared } : {}),
    mcpServerNames: plugin.enabled
      ? declared.map((name) => `plugin:${plugin.name}:${name}`)
      : [],
    rootPath: plugin.path,
    rootSource: "user",
    enabledSource: "user",
  };
}

export function installedSummary(
  plugin: PluginSummary,
  loaded: LoadedPlugin | undefined,
  snapshot: PluginsSnapshot,
  catalog: Map<string, MarketplacePluginEntry>,
  installedAt: string | undefined,
): ZCodeInstalledPluginSummary {
  const entry = catalog.get(plugin.id);
  const latestVersion = entry?.version;
  const updateStatus =
    latestVersion === undefined
      ? undefined
      : latestVersion === plugin.version
        ? ("none" as const)
        : ("update-available" as const);
  const listing = entry ? toListing(entry) : undefined;
  const types = loaded
    ? componentTypes(loaded, countsFor(snapshot, plugin))
    : [];
  return {
    id: plugin.id,
    name: plugin.name,
    marketplace: marketplaceOf(plugin.id),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    scope: "user",
    installPath: plugin.path,
    ...(installedAt ? { installedAt } : {}),
    ...(types.length > 0 ? { componentTypes: types } : {}),
    ...(updateStatus ? { updateStatus } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    ...(listing ? { listing } : {}),
  };
}

export function availableSummary(
  marketplace: string,
  entry: MarketplacePluginEntry,
  installedIds: ReadonlySet<string>,
): ZCodeAvailablePluginSummary {
  const id = `${entry.name}@${marketplace}`;
  const listing = toListing(entry);
  return {
    id,
    name: entry.name,
    marketplace,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    installed: installedIds.has(id),
    ...(listing ? { listing } : {}),
  };
}

export function marketplaceSummary(
  catalog: Catalog,
): ZCodePluginMarketplaceSummary {
  const description = catalog.manifest?.metadata?.description;
  return {
    id: catalog.name,
    name: catalog.name,
    source: catalog.record.source as unknown as Record<string, unknown>,
    ...(description ? { description } : {}),
    lastUpdated: catalog.record.lastUpdated,
    pluginCount: catalog.manifest?.plugins.length ?? 0,
    isOfficial: OFFICIAL_MARKETPLACE_NAMES.has(catalog.name),
    ...(catalog.failure
      ? {
          refreshFailure: {
            code: catalog.failure.code,
            failedAt: new Date().toISOString(),
            message: catalog.failure.message,
          },
        }
      : {}),
  };
}

export function installSummaryFallback(entry: {
  id: string;
  installPath: string;
  version: string;
}): ZCodeInstalledPluginSummary {
  const { name, marketplace } = splitPluginId(entry.id);
  return {
    id: entry.id,
    name,
    marketplace,
    version: entry.version,
    enabled: true,
    scope: "user",
    installPath: entry.installPath,
  };
}

export function describeSource(source: KnownMarketplace["source"]): string {
  switch (source.source) {
    case "directory":
      return `directory ${source.path}`;
    case "file":
      return `file ${source.path}`;
    case "url":
      return `url ${source.url}`;
    case "github":
      return `github ${source.repo}`;
    case "git":
      return `git ${source.url}`;
    case "npm":
      return `npm ${source.package}`;
  }
}

export function legacyMarketplaceSummary(
  catalog: Catalog,
): PluginMarketplaceSummary {
  const description = catalog.manifest?.metadata?.description;
  return {
    id: catalog.name,
    name: catalog.name,
    source: describeSource(catalog.record.source),
    installLocation: catalog.record.installLocation,
    lastUpdated: catalog.record.lastUpdated,
    pluginCount: catalog.manifest?.plugins.length ?? 0,
    ...(description ? { description } : {}),
    isOfficial: OFFICIAL_MARKETPLACE_NAMES.has(catalog.name),
  };
}

export function legacyAvailableSummary(
  catalog: Catalog,
  entry: MarketplacePluginEntry,
  installedIds: ReadonlySet<string>,
): AvailablePluginSummary {
  const id = `${entry.name}@${catalog.name}`;
  return {
    id,
    name: entry.name,
    marketplace: catalog.name,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    installed: installedIds.has(id),
  };
}

export function legacyInstalledSummary(
  plugin: PluginSummary,
  loaded: LoadedPlugin | undefined,
  snapshot: PluginsSnapshot,
  installedAt: string | undefined,
): InstalledPluginSummary {
  const types = loaded
    ? componentTypes(loaded, countsFor(snapshot, plugin))
    : [];
  return {
    id: plugin.id,
    name: plugin.name,
    marketplace: marketplaceOf(plugin.id),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    scope: "user",
    installPath: plugin.path,
    nativeScope: "user",
    ...(installedAt ? { installedAt } : {}),
    ...(types.length > 0 ? { componentTypes: types } : {}),
  };
}
