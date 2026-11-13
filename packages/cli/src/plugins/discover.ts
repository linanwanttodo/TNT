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
/**
 * The marketplaces registered on first discovery.
 *
 * The ZCode public catalogue is an HTTP manifest, so it works on a machine
 * where GitHub is unreachable; the Claude Code official repository is added
 * beside it. Both are seed sources: the reader can add any other source in the
 * panel. Neither is a hard dependency.
 */
export const DEFAULT_MARKETPLACES: ReadonlyArray<{
  name: string;
  source: { source: "url"; url: string } | { source: "github"; repo: string };
}> = [
  {
    name: "zcode-plugins-official",
    source: {
      source: "url",
      url: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    },
  },
  {
    name: "claude-plugins-official",
    source: {
      source: "github",
      repo: "anthropics/claude-plugins-official",
    },
  },
];

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
  const known = loadKnownMarketplaces();
  // Seeding is a first-run concern. A reader who has registered a marketplace
  // has taken ownership of the list: do not reach the network on every panel
  // open to add ours beside theirs.
  if (Object.keys(known).length > 0) {
    return { registered: false, message: "" };
  }
  const missing = DEFAULT_MARKETPLACES;
  const added: string[] = [];
  const failures: string[] = [];
  for (const entry of missing) {
    try {
      const result = await addMarketplace(
        entry.name,
        entry.source,
        createDefaultDeps(),
      );
      added.push(`${entry.name} (${result.manifest.plugins.length} plugins)`);
    } catch (error) {
      failures.push(`${entry.name}: ${(error as Error).message}`);
    }
  }
  return {
    registered: added.length > 0,
    message: [
      ...(added.length > 0 ? [`Added marketplaces: ${added.join(", ")}`] : []),
      ...(failures.length > 0
        ? [
            `Could not add: ${failures.join("; ")}. /plugins marketplace add <source> still works`,
          ]
        : []),
    ].join(" "),
  };
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
