import fs from "fs";
import path from "path";

import { t } from "../i18n/index.js";
import { getPluginSearchRoots } from "../plugins/directories.js";
import {
  searchCatalogPlugins,
  type CatalogEntry,
} from "../plugins/discover.js";
import { expandListField, loadAllPlugins } from "../plugins/loader.js";
import {
  discoverInstalledPlugins,
  type LoadedPlugin,
} from "../plugins/manifest.js";
import { parseMarketplaceManifest } from "../plugins/marketplaceManager.js";
import {
  loadInstalledPlugins,
  loadKnownMarketplaces,
} from "../plugins/marketplaceRegistry.js";
import type {
  MarketplacePluginEntry,
  PluginSource,
} from "../plugins/marketplaceTypes.js";

import { theme } from "./theme/tokens.js";

export type StatusKind =
  "enabled" | "disabled" | "update" | "pending" | "error" | "not-installed";

export interface InstalledEntry {
  plugin: LoadedPlugin;
  version?: string;
  enabled: boolean;
}

export interface ListRow {
  key: string;
  name: string;
  marketplace: string;
  detail: string;
  installed: boolean;
  version?: string;
  updateVersion?: string;
  enabled?: boolean;
  /** Install count from the official marketplace statistics, when known. */
  installs?: number;
}

export interface DetailTarget {
  name: string;
  marketplace: string;
}

export interface PluginComponents {
  commands: string[];
  agents: string[];
  skills: string[];
  mcpServers: string[];
}

export interface BrowserSnapshot {
  all: InstalledEntry[];
  unknownEnabled: string[];
}

export function splitPluginId(id: string): {
  name: string;
  marketplace: string;
} {
  const at = id.lastIndexOf("@");
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: "" };
}

export function describeSource(source: PluginSource | undefined): string {
  if (!source) return "";
  if (typeof source === "string") return source;
  switch (source.source) {
    case "npm":
      return `npm:${source.package}`;
    case "github":
      return `github:${source.repo}`;
    case "url":
      return `url:${source.url}`;
    case "git-subdir":
      return `git:${source.url} (${source.path})`;
    case "pip":
      return `pip:${source.package ?? ""}`;
    default:
      return "";
  }
}

/**
 * Reads every registered marketplace, keeping the names that failed instead of
 * dropping them. A single unreadable cache must leave the other catalogs on
 * screen and surface which marketplace is missing.
 */
export function loadCatalogs(): {
  catalogs: CatalogEntry[];
  failed: string[];
} {
  const known = loadKnownMarketplaces();
  const catalogs: CatalogEntry[] = [];
  const failed: string[] = [];
  for (const marketplace of Object.keys(known).sort()) {
    try {
      const manifest = parseMarketplaceManifest(
        JSON.parse(
          fs.readFileSync(known[marketplace].installLocation, "utf-8"),
        ),
      );
      catalogs.push({ marketplace, plugins: manifest.plugins });
    } catch {
      failed.push(marketplace);
    }
  }
  return { catalogs, failed };
}

export function updateVersionFor(
  installed: InstalledEntry | undefined,
  entry: MarketplacePluginEntry | undefined,
): string | undefined {
  if (!installed || !entry?.version) return undefined;
  return entry.version === (installed.version ?? "0.0.0")
    ? undefined
    : entry.version;
}

export function loadBrowserSnapshot(): BrowserSnapshot {
  const loaded = loadAllPlugins();
  const enabledIds = new Set(loaded.plugins.map((plugin) => plugin.id));
  const registry = loadInstalledPlugins();
  const all: InstalledEntry[] = discoverInstalledPlugins(
    getPluginSearchRoots(),
  ).map((plugin) => ({
    plugin,
    version: registry.plugins[plugin.id]?.[0]?.version ?? plugin.version,
    enabled: enabledIds.has(plugin.id),
  }));
  return { all, unknownEnabled: loaded.unknownEnabledPlugins };
}

function readMarkdownNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => path.basename(file, ".md"));
  } catch {
    return [];
  }
}

function safeSubdirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => {
        try {
          return fs.statSync(path.join(dir, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function readSkillName(file: string, fallback: string): string {
  try {
    const match = /^name:\s*(.+)$/m.exec(fs.readFileSync(file, "utf-8"));
    return match?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function readSkillNames(dir: string): string[] {
  const names: string[] = [];
  const direct = path.join(dir, "SKILL.md");
  if (fs.existsSync(direct)) {
    names.push(readSkillName(direct, path.basename(dir)));
  }
  for (const entry of safeSubdirectories(dir)) {
    const nested = path.join(dir, entry, "SKILL.md");
    if (fs.existsSync(nested)) {
      names.push(readSkillName(nested, entry));
    }
  }
  return names;
}

function contributionDirectories(
  plugin: LoadedPlugin,
  field: unknown,
  fallback: string,
): string[] {
  const declared = expandListField(field);
  const entries = declared.length > 0 ? declared : [fallback];
  return entries.map((entry) =>
    path.isAbsolute(entry) ? entry : path.resolve(plugin.path, entry),
  );
}

function readMcpServerNames(plugin: LoadedPlugin): string[] {
  const value = plugin.manifest.mcpServers;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.resolve(plugin.path, value), "utf-8"),
      );
      if (!parsed || typeof parsed !== "object") return [];
      const wrapped = (parsed as Record<string, unknown>).mcpServers;
      const servers =
        wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
          ? (wrapped as Record<string, unknown>)
          : (parsed as Record<string, unknown>);
      return Object.keys(servers);
    } catch {
      return [];
    }
  }
  return Object.keys(value);
}

export function componentsFor(plugin: LoadedPlugin): PluginComponents {
  return {
    commands: contributionDirectories(
      plugin,
      plugin.manifest.commands,
      "commands",
    ).flatMap(readMarkdownNames),
    agents: contributionDirectories(
      plugin,
      plugin.manifest.agents,
      "agents",
    ).flatMap(readMarkdownNames),
    skills: contributionDirectories(
      plugin,
      plugin.manifest.skills,
      "skills",
    ).flatMap(readSkillNames),
    mcpServers: readMcpServerNames(plugin),
  };
}

export function hasComponents(components: PluginComponents): boolean {
  return (
    components.commands.length > 0 ||
    components.agents.length > 0 ||
    components.skills.length > 0 ||
    components.mcpServers.length > 0
  );
}

export function installedRowsFor(
  snapshot: BrowserSnapshot,
  catalogs: CatalogEntry[] | null,
): ListRow[] {
  return snapshot.all.map((installed) => {
    const { name, marketplace } = splitPluginId(installed.plugin.id);
    const entry = catalogs
      ?.find((catalog) => catalog.marketplace === marketplace)
      ?.plugins.find((plugin) => plugin.name === name);
    return {
      key: installed.plugin.id,
      name,
      marketplace,
      detail: installed.plugin.description ?? "",
      installed: true,
      version: installed.version,
      enabled: installed.enabled,
      updateVersion: updateVersionFor(installed, entry),
    };
  });
}

export function discoverRowsFor(
  catalogs: CatalogEntry[] | null,
  query: string,
  snapshot: BrowserSnapshot,
  installCounts?: Map<string, number>,
): ListRow[] {
  if (catalogs === null) return [];
  const rows = searchCatalogPlugins(catalogs, query).map((match) => {
    const key = `${match.plugin.name}@${match.marketplace}`;
    const installed = snapshot.all.find(
      (candidate) => candidate.plugin.id === key,
    );
    return {
      key,
      name: match.plugin.name,
      marketplace: match.marketplace,
      detail: match.plugin.description ?? "",
      installed: Boolean(installed),
      version: match.plugin.version,
      enabled: installed?.enabled,
      updateVersion: updateVersionFor(installed, match.plugin),
      installs: installCounts?.get(key),
    };
  });
  return rows.sort((a, b) => {
    const countA = a.installs ?? 0;
    const countB = b.installs ?? 0;
    if (countA !== countB) return countB - countA;
    return a.name.localeCompare(b.name);
  });
}

/** Rows for errors: catalogs that failed to load and enabled-but-missing plugins. */
export function errorRowsFor(
  failed: string[],
  unknownEnabled: string[],
): ListRow[] {
  return [
    ...failed.map((name) => ({
      key: `catalog:${name}`,
      name: t("plugins.browser.marketplaceRow", { name }),
      marketplace: name,
      detail: t("plugins.browser.catalogWarning", { names: name }),
      installed: false,
    })),
    ...unknownEnabled.map((id) => ({
      key: `enabled:${id}`,
      name: id,
      marketplace: "",
      detail: t("plugins.browser.unknownEnabledWarning", { names: id }),
      installed: false,
    })),
  ];
}

/** Rows for the stats tab: one row per fact a reader may want to check. */
export function statsRowsFor(
  installed: number,
  marketplaces: number,
  catalog: number,
): ListRow[] {
  return [
    {
      key: "stats:total",
      name: t("plugins.browser.statsSummary", {
        plugins: installed,
        marketplaces,
        catalog,
      }),
      marketplace: "",
      detail: "",
      installed: false,
    },
  ];
}

/** Rows for installed services: MCP servers, skills and commands from plugins. */
export function serviceRowsFor(snapshot: BrowserSnapshot): ListRow[] {
  const rows: ListRow[] = [];
  for (const installed of snapshot.all) {
    const components = componentsFor(installed.plugin);
    if (!hasComponents(components)) continue;
    for (const [field, label] of [
      ["mcpServers", "plugins.browser.servicesMcp"],
      ["skills", "plugins.browser.servicesSkills"],
      ["commands", "plugins.browser.servicesCommands"],
      ["agents", "plugins.browser.servicesAgents"],
    ] as const) {
      const values = components[field];
      if (values.length === 0) continue;
      rows.push({
        key: `service:${installed.plugin.id}:${field}`,
        name: `${installed.plugin.id} · ${t(label, { list: values.join(", ") })}`,
        marketplace: "",
        detail: "",
        installed: true,
      });
    }
  }
  return rows;
}

export function marketplaceRowsFor(catalogs: CatalogEntry[] | null): ListRow[] {
  const known = loadKnownMarketplaces();
  return Object.keys(known)
    .sort()
    .map((name) => {
      const count = catalogs?.find((c) => c.marketplace === name)?.plugins
        .length;
      return {
        key: name,
        name,
        marketplace: "",
        detail:
          count === undefined
            ? t("plugins.browser.marketplaceUnknownCount")
            : t("plugins.browser.marketplaceCount", { count }),
        installed: false,
      };
    });
}

export function detailStatusKind(
  installed: InstalledEntry | undefined,
  id: string,
  busy: string | null,
  error: string | undefined,
  updateTo: string | undefined,
): StatusKind {
  if (installed === undefined) return "not-installed";
  if (busy === id) return "pending";
  if (error !== undefined) return "error";
  if (installed.enabled === false) return "disabled";
  if (updateTo !== undefined) return "update";
  return "enabled";
}

export function statusLabel(kind: StatusKind): string {
  switch (kind) {
    case "enabled":
      return t("plugins.browser.statusEnabled");
    case "disabled":
      return t("plugins.browser.statusDisabled");
    case "update":
      return t("plugins.browser.statusUpdate");
    case "pending":
      return t("plugins.browser.statusPending");
    case "error":
      return t("plugins.browser.statusError");
    case "not-installed":
      return t("plugins.browser.statusNotInstalled");
  }
}

export function statusColor(kind: StatusKind): string {
  switch (kind) {
    case "enabled":
      return "green";
    case "disabled":
      return theme.status.idle;
    case "update":
      return "cyan";
    case "pending":
      return theme.status.idle;
    case "error":
      return "red";
    case "not-installed":
      return "gray";
  }
}
