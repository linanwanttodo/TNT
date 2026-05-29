/**
 * The plugin marketplace surface behind the web UI's marketplace page:
 * list what the registered marketplaces carry, refresh a catalogue, and
 * install one of its plugins - the same flows the CLI's /plugin marketplace
 * commands drive, without the terminal.
 */
import fs from "fs";

import { parseMarketplaceManifest } from "../plugins/marketplaceManager.js";
import { createDefaultDeps } from "../plugins/marketplaceManager.js";
import { loadKnownMarketplaces } from "../plugins/marketplaceRegistry.js";
import { installPlugin } from "../plugins/pluginInstall.js";

import { listInstalledPlugins, reloadPlugins } from "./webuiPlugins.js";

export interface MarketplacePluginListing {
  name: string;
  description: string;
  version: string;
  category: string;
  installed: boolean;
}

export interface MarketplaceListing {
  name: string;
  lastUpdated: string | null;
  plugins: MarketplacePluginListing[];
}

/**
 * Read every known marketplace's cached manifest and project it with the
 * installed set. A marketplace whose cache is missing (added but never
 * fetched) lists as empty rather than failing the whole page.
 */
export function listMarketplaces(): MarketplaceListing[] {
  const installed = new Set(
    listInstalledPlugins().plugins.map((plugin) => plugin.id),
  );
  const marketplaces = loadKnownMarketplaces();
  return Object.entries(marketplaces)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, record]) => {
      let plugins: MarketplacePluginListing[] = [];
      try {
        const manifest = parseMarketplaceManifest(
          JSON.parse(fs.readFileSync(record.installLocation, "utf-8")),
        );
        plugins = manifest.plugins.map((entry) => ({
          name: entry.name,
          description: entry.description ?? "",
          version: entry.version ?? "",
          category: entry.category ?? "",
          installed: installed.has(`${entry.name}@${name}`),
        }));
      } catch {
        // Unfetched or unreadable cache: the refresh button is the fix.
        plugins = [];
      }
      return {
        name,
        lastUpdated: record.lastUpdated ?? null,
        plugins,
      };
    });
}

export async function refreshNamedMarketplace(
  name: string,
): Promise<MarketplaceListing[]> {
  const { refreshMarketplace } =
    await import("../plugins/marketplaceManager.js");
  await refreshMarketplace(name);
  return listMarketplaces();
}

export async function installNamedMarketplacePlugin(
  marketplace: string,
  plugin: string,
): Promise<MarketplaceListing[]> {
  await installPlugin(marketplace, plugin, createDefaultDeps());
  // The loader memo still holds the pre-install world; drop it so the next
  // listing (and the running session) sees the new plugin.
  reloadPlugins();
  return listMarketplaces();
}
