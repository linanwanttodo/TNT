import type { Catalog } from "./pluginMapping.js";
import type {
  KnownMarketplace,
  MarketplaceManifest,
  MarketplacePluginEntry,
  PluginSource,
} from "../../plugins/marketplaceTypes.js";

/**
 * A locally cached external plugin source. TNT reads Claude Code's own
 * marketplace caches and pi extension packages without fetching a URL:
 * everything is already on disk, so WebUI and TUI list the same catalogue
 * offline.
 */
export interface ExternalPluginSource {
  name: string;
  description: string;
  entries: MarketplacePluginEntry[];
  publisherType?: "official" | "community";
}

function githubSource(url: string): PluginSource | null {
  const trimmed = url
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match = trimmed.match(
    /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/,
  );
  if (!match) return null;
  return { source: "github", repo: `${match[1]}/${match[2]}` };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "plugin"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceFrom(value: unknown): PluginSource | null {
  // Only public https URLs are accepted as remote sources: a localhost,
  // loopback or otherwise private endpoint must never become a fetch target.
  const fromUrl = (raw: string): PluginSource | null => {
    const trimmed = raw.trim();
    const github = githubSource(trimmed);
    if (github) return github;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") return null;
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
        host === "::1" ||
        host === "0.0.0.0"
      ) {
        return null;
      }
      return { source: "url", url: trimmed };
    } catch {
      return null;
    }
  };
  if (typeof value === "string" && value.trim()) return fromUrl(value);
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.url === "string") return fromUrl(record.url);
  if (typeof record.repo === "string") {
    return { source: "github", repo: record.repo };
  }
  if (typeof record.package === "string") {
    return { source: "npm", package: record.package };
  }
  return null;
}

export function entryFromDirectoryListing(
  raw: unknown,
): MarketplacePluginEntry | null {
  const listing = asRecord(raw);
  const name = typeof listing?.name === "string" ? listing.name : "";
  if (!listing || !name) return null;
  const release = asRecord(listing.release);
  const version =
    typeof release?.version === "string" ? release.version : undefined;
  const sourceRecord = asRecord(listing.source);
  const repository = asRecord(sourceRecord?.repository);
  const source = sourceFrom(repository?.url ?? "");
  if (!source) return null;
  const summary =
    typeof listing.summary === "string" ? listing.summary : undefined;
  return {
    name: slugify(name),
    source,
    displayName: name,
    ...(summary ? { description: summary } : {}),
    ...(version ? { version } : {}),
    publisherType: "community",
  };
}

export function entryFromCatalogPlugin(
  raw: unknown,
  nameHint?: string,
): MarketplacePluginEntry | null {
  const plugin = asRecord(raw);
  const name =
    typeof plugin?.name === "string"
      ? plugin.name
      : typeof nameHint === "string"
        ? nameHint
        : "";
  if (!plugin || !name) return null;
  const source = sourceFrom(plugin.source);
  if (!source) return null;
  const description =
    typeof plugin.description === "string" ? plugin.description : undefined;
  const version =
    typeof plugin.version === "string" ? plugin.version : undefined;
  const icon = typeof plugin.icon === "string" ? plugin.icon : undefined;
  return {
    name: slugify(name),
    source,
    displayName:
      typeof plugin.displayName === "string" ? plugin.displayName : name,
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    ...(icon ? { icon } : {}),
    publisherType: "official",
  };
}

export function uniqueEntries(
  entries: Array<MarketplacePluginEntry | null>,
): MarketplacePluginEntry[] {
  const seen = new Set<string>();
  const result: MarketplacePluginEntry[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    result.push(entry);
  }
  return result;
}

/** Convert one external source into the catalogue shape the shell consumes. */
export function externalSourceToCatalog(
  source: ExternalPluginSource,
): Catalog | null {
  if (source.entries.length === 0) return null;
  const record: KnownMarketplace = {
    source: { source: "directory", path: source.name },
    installLocation: source.name,
    lastUpdated: new Date().toISOString(),
  };
  const manifest: MarketplaceManifest = {
    name: source.name,
    owner: {
      name: source.publisherType === "official" ? "Official" : "Community",
    },
    plugins: source.entries.map((entry) => ({
      ...entry,
      publisherType: source.publisherType ?? entry.publisherType,
    })),
    metadata: { description: source.description },
  };
  return { name: source.name, record, manifest };
}
