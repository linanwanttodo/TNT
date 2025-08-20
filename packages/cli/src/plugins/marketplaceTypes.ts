/**
 * On-disk shapes for the plugin marketplace, field-compatible with the layout
 * that `src/plugins/directories.ts` mirrors, so a tree written by another tool
 * can be read without migration.
 */

export type MarketplaceSource =
  | { source: "url"; url: string; headers?: Record<string, string> }
  | {
      source: "github";
      repo: string;
      ref?: string;
      path?: string;
      sparsePaths?: string[];
    }
  | {
      source: "git";
      url: string;
      ref?: string;
      path?: string;
      sparsePaths?: string[];
    }
  | { source: "npm"; package: string }
  | { source: "file"; path: string }
  | { source: "directory"; path: string };

export interface KnownMarketplace {
  source: MarketplaceSource;
  /** Absolute path where the marketplace manifest is cached. */
  installLocation: string;
  lastUpdated: string;
  autoUpdate?: boolean;
  /**
   * Digest of the manifest as it was when last read. For a local source the
   * file itself is the marketplace, so only a stored digest can say whether a
   * refresh found something new.
   */
  manifestDigest?: string;
}

export type KnownMarketplacesFile = Record<string, KnownMarketplace>;

export type InstallationScope = "managed" | "user" | "project" | "local";

export interface PluginInstallationEntry {
  scope: InstallationScope;
  installPath: string;
  projectPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

interface LegacyInstalledPlugin {
  version: string;
  installedAt: string;
  lastUpdated?: string;
  installPath: string;
  gitCommitSha?: string;
}

/** installed_plugins.json envelope; version 1 stores a single entry per id. */
export type InstalledPluginsFile =
  | { version: 1; plugins: Record<string, LegacyInstalledPlugin> }
  | { version: 2; plugins: Record<string, PluginInstallationEntry[]> };

export interface MarketplaceAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * The object spelling of a plugin source, as a catalogue written for the
 * reference tool declares it. A url source means a git repository.
 */
export type PluginSourceObject =
  | { source: "npm"; package: string; version?: string; registry?: string }
  | { source: "github"; repo: string; ref?: string }
  | { source: "url"; url: string; ref?: string }
  | { source: "git-subdir"; url: string; path: string; ref?: string }
  | { source: "pip"; package?: string };

export type PluginSource = string | PluginSourceObject;

export interface MarketplacePluginEntry {
  name: string;
  source: PluginSource;
  version?: string;
  description?: string;
  category?: string;
  tags?: string[];
  author?: MarketplaceAuthor;
  dependencies?: string[];
}

export interface MarketplaceManifest {
  name: string;
  owner: MarketplaceAuthor;
  plugins: MarketplacePluginEntry[];
  metadata?: { pluginRoot?: string; version?: string; description?: string };
  forceRemoveDeletedPlugins?: boolean;
  allowCrossMarketplaceDependenciesOn?: string[];
}

/** "name@marketplace", the id format the loader already produces. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][-a-z0-9._]*@[a-z0-9][-a-z0-9._]*$/i;

export function isPluginId(value: string): boolean {
  return PLUGIN_ID_PATTERN.test(value);
}

export function splitPluginId(id: string): {
  name: string;
  marketplace: string;
} {
  const at = id.lastIndexOf("@");
  if (at <= 0) {
    throw new Error(`Not a plugin id: ${id}`);
  }
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/**
 * Filesystem-safe path segment. Marketplace and plugin names arrive from remote
 * manifests, so anything that could escape the cache directory is replaced, and
 * a segment that would resolve to "this or the parent directory" is refused.
 */
export function sanitizeSegment(name: string): string {
  const replaced = name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const trimmed = replaced.replace(/^\.+/, "").replace(/^\.+|\.+$/g, "");
  return trimmed || "-";
}

export function isSameSource(
  a: MarketplaceSource | undefined,
  b: MarketplaceSource,
): boolean {
  if (!a || a.source !== b.source) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
