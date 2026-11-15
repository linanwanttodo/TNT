import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { globalDirOverride } from "../../config/globalDir.js";

import type { Catalog } from "./pluginMapping.js";
import {
  entryFromCatalogPlugin,
  entryFromDirectoryListing,
  externalSourceToCatalog,
  uniqueEntries,
  type ExternalPluginSource,
} from "./externalPluginSources.js";

/**
 * External plugin sources are read-only Claude Code caches: the official
 * marketplace, the community directory and its catalogue. pi uses a different
 * runtime (in-process TypeScript extensions), so it is not a plugin source
 * here. Both the browser store and the TUI plugin command consume this list.
 */
const CLAUDE_OFFICIAL = "claude-plugins-official";
const CLAUDE_DIRECTORY = "claude-plugin-directory";

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function claudeRoot(override?: string): string {
  return override ?? path.join(os.homedir(), ".claude", "plugins");
}

function officialSources(root: string): ExternalPluginSource[] {
  const known = asRecord(readJson(path.join(root, "known_marketplaces.json")));
  const cached = asRecord(
    readJson(path.join(root, "plugin-catalog-cache.json")),
  );
  const catalog = asRecord(cached?.catalog);
  const plugins = catalog?.plugins;
  const entries = uniqueEntries(
    plugins && typeof plugins === "object" && !Array.isArray(plugins)
      ? Object.entries(plugins as Record<string, unknown>).map(([name, raw]) =>
          entryFromCatalogPlugin(raw, name),
        )
      : Array.isArray(plugins)
        ? (plugins as unknown[]).map((raw) => entryFromCatalogPlugin(raw))
        : [],
  );
  const sources: ExternalPluginSource[] = [];
  if (entries.length > 0) {
    sources.push({
      name: CLAUDE_OFFICIAL,
      description: "Claude Code official marketplace (local cache)",
      entries,
      publisherType: "official",
    });
  }
  if (known) {
    for (const [name, record] of Object.entries(known)) {
      if (name === CLAUDE_OFFICIAL) continue;
      const value = asRecord(record);
      const location =
        typeof value?.installLocation === "string" ? value.installLocation : "";
      if (!location) continue;
      const manifestPath = path.join(
        location,
        ".claude-plugin",
        "marketplace.json",
      );
      const manifest = asRecord(readJson(manifestPath));
      const listed = Array.isArray(manifest?.plugins)
        ? (manifest.plugins as unknown[])
        : [];
      const extra = uniqueEntries(
        listed.map((raw) => entryFromCatalogPlugin(raw)),
      );
      if (extra.length > 0) {
        sources.push({
          name: `claude-${name}`,
          description: `Claude Code marketplace: ${name}`,
          entries: extra,
          publisherType: "community",
        });
      }
    }
  }
  return sources;
}

function directorySource(root: string): ExternalPluginSource | null {
  const cached = asRecord(
    readJson(path.join(root, "plugin-directory-cache-v2.json")),
  );
  const listings = Array.isArray(cached?.listings)
    ? (cached.listings as unknown[])
    : [];
  const entries = uniqueEntries(
    listings.map((raw) => entryFromDirectoryListing(raw)),
  );
  if (entries.length === 0) return null;
  return {
    name: CLAUDE_DIRECTORY,
    description: "Claude Code community plugin directory (local cache)",
    entries,
    publisherType: "community",
  };
}

/** Catalogues from the local Claude Code caches, merged by name. */
export function readExternalCatalogs(claudeDir?: string): Catalog[] {
  // Tests and embedders point TNT at a temporary global dir; their plugin
  // fixtures must not be mixed with the operator's real Claude caches.
  // An explicitly supplied directory is always read (used by the unit tests).
  if (!claudeDir && globalDirOverride()) return [];
  const root = claudeRoot(claudeDir);
  const sources = [...officialSources(root), directorySource(root)].filter(
    (source): source is ExternalPluginSource => source !== null,
  );
  return sources
    .map((source) => externalSourceToCatalog(source))
    .filter((catalog): catalog is Catalog => catalog !== null);
}
