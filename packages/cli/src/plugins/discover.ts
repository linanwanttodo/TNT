import fs from "fs";

import {
  addMarketplace,
  createDefaultDeps,
  parseMarketplaceManifest,
} from "./marketplaceManager.js";
import { loadKnownMarketplaces } from "./marketplaceRegistry.js";
import {
  MarketplaceManifest,
  MarketplacePluginEntry,
} from "./marketplaceTypes.js";

/**
 * The marketplace registered on first discovery, so `/plugins` search, the
 * browser and bare installs work before the user has added anything. The
 * official catalogue is the same upstream repo the official tooling ships.
 */
export const DEFAULT_MARKETPLACE = {
  name: "claude-plugins-official",
  repo: "anthropics/claude-plugins-official",
} as const;

export interface EnsureDefaultResult {
  registered: boolean;
  /** What happened, for the status line: added, already present, or failed. */
  message: string;
}

/**
 * Registers the official catalogue when no marketplace is known. Network
 * failures are reported, never thrown: an offline `/plugins` must still list
 * what is installed.
 */
export async function ensureDefaultMarketplace(): Promise<EnsureDefaultResult> {
  if (Object.keys(loadKnownMarketplaces()).length > 0) {
    return { registered: false, message: "" };
  }
  try {
    const result = await addMarketplace(
      DEFAULT_MARKETPLACE.name,
      { source: "github", repo: DEFAULT_MARKETPLACE.repo },
      createDefaultDeps(),
    );
    return {
      registered: true,
      message: `Added the official marketplace ${DEFAULT_MARKETPLACE.name} (${result.manifest.plugins.length} plugins)`,
    };
  } catch (error) {
    return {
      registered: false,
      message: `Could not add the official marketplace (${(error as Error).message}); /plugins marketplace add <source> still works`,
    };
  }
}

export interface CatalogEntry {
  marketplace: string;
  plugins: MarketplacePluginEntry[];
}

/** Reads every registered marketplace's manifest from its recorded location. */
export function loadMarketplaceCatalogs(): CatalogEntry[] {
  const known = loadKnownMarketplaces();
  const catalogs: CatalogEntry[] = [];
  for (const name of Object.keys(known).sort()) {
    try {
      const manifest: MarketplaceManifest = parseMarketplaceManifest(
        JSON.parse(fs.readFileSync(known[name].installLocation, "utf-8")),
      );
      catalogs.push({ marketplace: name, plugins: manifest.plugins });
    } catch {
      // A marketplace whose cached manifest went missing or malformed is
      // skipped here; `/plugins marketplace list` and a refresh surface it.
    }
  }
  return catalogs;
}

/** The keyword a plugin entry must match in, case-insensitively. */
function entryText(entry: MarketplacePluginEntry): string {
  return [
    entry.name,
    entry.description ?? "",
    entry.category ?? "",
    (entry.tags ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/** Pure keyword filter so the UI and the text command agree on results. */
export function searchCatalogPlugins(
  catalogs: CatalogEntry[],
  keyword: string,
): (CatalogEntry & { plugin: MarketplacePluginEntry })[] {
  const query = keyword.trim().toLowerCase();
  const matches: (CatalogEntry & { plugin: MarketplacePluginEntry })[] = [];
  for (const catalog of catalogs) {
    for (const plugin of catalog.plugins) {
      if (query === "" || entryText(plugin).includes(query)) {
        matches.push({ ...catalog, plugin });
      }
    }
  }
  return matches;
}
