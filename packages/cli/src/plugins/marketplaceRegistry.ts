import fs from "fs";
import path from "path";

import {
  getInstalledPluginsPath,
  getKnownMarketplacesPath,
  getMarketplacesDirectory,
} from "./directories.js";
import {
  InstalledPluginsFile,
  KnownMarketplace,
  KnownMarketplacesFile,
  PluginInstallationEntry,
  isPluginId,
} from "./marketplaceTypes.js";

const MARKETPLACE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export class MarketplaceRegistryError extends Error {}

function assertMarketplaceName(name: string): void {
  if (!MARKETPLACE_NAME_PATTERN.test(name) || name.includes("..")) {
    throw new MarketplaceRegistryError(
      `Unsafe marketplace name: ${JSON.stringify(name)}`,
    );
  }
}

/**
 * Refuse to store a location that a later cleanup could resolve outside the
 * marketplace cache. `file` and `directory` sources may live anywhere the user
 * owns, so this guards only the paths the registry removes.
 */
export function assertInsideCache(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new MarketplaceRegistryError(
      `Refusing to touch a path outside the marketplace cache: ${target}`,
    );
  }
}

function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new MarketplaceRegistryError(
      `Corrupted marketplace registry ${file}: ${(error as Error).message}`,
    );
  }
}

function writeJsonFile(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write then replace, so an interrupted save cannot truncate the registry.
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function loadKnownMarketplaces(): KnownMarketplacesFile {
  const parsed = readJsonFile<KnownMarketplacesFile>(
    getKnownMarketplacesPath(),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
}

export function saveKnownMarketplaces(
  marketplaces: KnownMarketplacesFile,
): void {
  for (const name of Object.keys(marketplaces)) {
    assertMarketplaceName(name);
  }
  writeJsonFile(getKnownMarketplacesPath(), marketplaces);
}

/**
 * Insert or replace one record. The previous record is returned so a caller can
 * tell a first add from a re-add and reuse a checkout when the source is
 * unchanged.
 */
export function rememberMarketplace(
  name: string,
  entry: KnownMarketplace,
): { previous?: KnownMarketplace } {
  assertMarketplaceName(name);
  if (!path.isAbsolute(entry.installLocation)) {
    throw new MarketplaceRegistryError(
      `installLocation must be absolute: ${entry.installLocation}`,
    );
  }
  const all = loadKnownMarketplaces();
  const previous = all[name];
  all[name] = {
    ...entry,
    installLocation: path.resolve(entry.installLocation),
  };
  saveKnownMarketplaces(all);
  return { previous };
}

export function forgetMarketplace(name: string): KnownMarketplace | null {
  assertMarketplaceName(name);
  const all = loadKnownMarketplaces();
  const removed = all[name];
  if (!removed) return null;
  delete all[name];
  saveKnownMarketplaces(all);
  return removed;
}

/**
 * Both on-disk shapes are accepted; the in-memory and written form is always
 * version 2, where one id can carry several scoped installations.
 */
export function loadInstalledPlugins(): {
  version: 2;
  plugins: Record<string, PluginInstallationEntry[]>;
} {
  const parsed = readJsonFile<InstalledPluginsFile>(getInstalledPluginsPath());
  const plugins: Record<string, PluginInstallationEntry[]> = {};
  if (!parsed || typeof parsed !== "object" || !parsed.plugins) {
    return { version: 2, plugins };
  }
  for (const [id, value] of Object.entries(parsed.plugins)) {
    if (!isPluginId(id)) {
      throw new MarketplaceRegistryError(`Not a plugin id: ${id}`);
    }
    if (Array.isArray(value)) {
      plugins[id] = value;
      continue;
    }
    const legacy = value as PluginInstallationEntry & { installedAt: string };
    plugins[id] = [
      {
        scope: "user",
        installPath: legacy.installPath,
        version: legacy.version,
        installedAt: legacy.installedAt,
        lastUpdated: legacy.lastUpdated,
        gitCommitSha: legacy.gitCommitSha,
      },
    ];
  }
  return { version: 2, plugins };
}

export function saveInstalledPlugins(
  file: ReturnType<typeof loadInstalledPlugins>,
): void {
  writeJsonFile(getInstalledPluginsPath(), file);
}

export function recordPluginInstallation(
  id: string,
  entry: PluginInstallationEntry,
): void {
  if (!isPluginId(id)) {
    throw new MarketplaceRegistryError(`Not a plugin id: ${id}`);
  }
  const file = loadInstalledPlugins();
  const existing = file.plugins[id] ?? [];
  const replaced = existing.filter(
    (candidate) =>
      candidate.scope !== entry.scope ||
      candidate.projectPath !== entry.projectPath,
  );
  file.plugins[id] = [...replaced, entry];
  saveInstalledPlugins(file);
}

export function removePluginInstallation(id: string): number {
  const file = loadInstalledPlugins();
  const removed = file.plugins[id];
  if (!removed) return 0;
  delete file.plugins[id];
  saveInstalledPlugins(file);
  return removed.length;
}

/** Path of a marketplace checkout inside the cache, for a given name. */
export function marketplaceCheckoutDir(name: string): string {
  assertMarketplaceName(name);
  return path.join(getMarketplacesDirectory(), name);
}
