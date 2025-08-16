import { execFile, spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import {
  isBlockedMarketplaceName,
  isReservedMarketplaceName,
} from "./loader.js";
import {
  KnownMarketplace,
  MarketplaceManifest,
  MarketplacePluginEntry,
  MarketplaceSource,
} from "./marketplaceTypes.js";
import { installPlugin } from "./pluginInstall.js";
import {
  CommandResult,
  MarketplaceDeps,
  resolveMarketplaceSource,
} from "./marketplaceSources.js";
import {
  loadInstalledPlugins,
  loadKnownMarketplaces,
  rememberMarketplace,
} from "./marketplaceRegistry.js";

export class MarketplaceManifestError extends Error {}

/** Only the upstream organization may claim the reserved catalogue names. */
function isOfficialSource(source: MarketplaceSource): boolean {
  if (source.source === "github") {
    return /^anthropics\//i.test(source.repo);
  }
  if (source.source === "git" || source.source === "url") {
    return /github\.com[/:]anthropics[/.]/i.test(source.url);
  }
  return false;
}

/**
 * A manifest is machine-supplied content from a remote repository, so every
 * field that later becomes a path, a command argument or a cache directory is
 * checked here rather than trusted.
 */
export function parseMarketplaceManifest(
  raw: unknown,
  expectedName?: string,
): MarketplaceManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MarketplaceManifestError(
      "Marketplace manifest must be an object",
    );
  }
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "";
  if (!name) {
    throw new MarketplaceManifestError("Marketplace manifest has no name");
  }
  if (isBlockedMarketplaceName(name)) {
    throw new MarketplaceManifestError(
      `Marketplace name impersonates an official catalogue: ${name}`,
    );
  }
  if (expectedName && expectedName !== name) {
    throw new MarketplaceManifestError(
      `Marketplace declares ${name} but was added as ${expectedName}`,
    );
  }
  const owner = value.owner as Record<string, unknown> | undefined;
  if (!owner || typeof owner.name !== "string" || !owner.name) {
    throw new MarketplaceManifestError("Marketplace manifest has no owner");
  }
  if (!Array.isArray(value.plugins)) {
    throw new MarketplaceManifestError("Marketplace plugins must be a list");
  }
  const plugins: MarketplacePluginEntry[] = [];
  for (const candidate of value.plugins) {
    if (!candidate || typeof candidate !== "object") {
      throw new MarketplaceManifestError(
        "Marketplace plugin entry is not an object",
      );
    }
    const entry = candidate as Record<string, unknown>;
    const pluginName = typeof entry.name === "string" ? entry.name : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    if (!pluginName || !source) {
      throw new MarketplaceManifestError(
        "Marketplace plugin needs both a name and a source",
      );
    }
    plugins.push({
      name: pluginName,
      source,
      version: typeof entry.version === "string" ? entry.version : undefined,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      category: typeof entry.category === "string" ? entry.category : undefined,
      tags: Array.isArray(entry.tags) ? (entry.tags as string[]) : undefined,
      dependencies: Array.isArray(entry.dependencies)
        ? (entry.dependencies as string[])
        : undefined,
      author: entry.author as MarketplacePluginEntry["author"],
    });
  }
  return {
    name,
    owner: {
      name: owner.name,
      email: typeof owner.email === "string" ? owner.email : undefined,
      url: typeof owner.url === "string" ? owner.url : undefined,
    },
    plugins,
    metadata: value.metadata as MarketplaceManifest["metadata"],
    forceRemoveDeletedPlugins:
      value.forceRemoveDeletedPlugins === true ? true : undefined,
    allowCrossMarketplaceDependenciesOn: Array.isArray(
      value.allowCrossMarketplaceDependenciesOn,
    )
      ? (value.allowCrossMarketplaceDependenciesOn as string[])
      : undefined,
  };
}

function runCommand(
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException).code === "string"
            ? 127
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function probeGitHubSsh(run: MarketplaceDeps["run"]): Promise<boolean> {
  // GitHub answers authentication success with exit code 1 and a banner; any
  // other shape means no usable key, so fall back to HTTPS.
  const probe = await run(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=2",
      "-o",
      "StrictHostKeyChecking=yes",
      "git@github.com",
    ],
    { env: {} },
  );
  return (
    probe.stderr.includes("successfully authenticated") ||
    probe.stdout.includes("successfully authenticated")
  );
}

export function createDefaultDeps(): MarketplaceDeps {
  let gitChecked: boolean | null = null;
  let sshChecked: boolean | null = null;
  return {
    run: runCommand,
    async fetchJson(url, headers) {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      return (await response.json()) as unknown;
    },
    gitAvailable() {
      if (gitChecked === null) {
        gitChecked = spawnSync("git", ["--version"]).status === 0;
      }
      return gitChecked;
    },
    async sshConfiguredForGitHub() {
      if (sshChecked === null) {
        sshChecked = await probeGitHubSsh(runCommand);
      }
      return sshChecked;
    },
  };
}

export interface AddMarketplaceResult {
  marketplace: KnownMarketplace;
  manifest: MarketplaceManifest;
  reused: boolean;
}

/**
 * Fetch or reuse a marketplace, validate what came back, and record it. The
 * registry is written only after validation, so a malformed remote manifest
 * cannot leave a half-known marketplace behind.
 */
export async function addMarketplace(
  name: string,
  source: MarketplaceSource,
  deps: MarketplaceDeps = createDefaultDeps(),
  registeredName?: string,
): Promise<AddMarketplaceResult> {
  const resolved = await resolveMarketplaceSource(source, name, deps);
  if (!fs.existsSync(resolved.manifestPath)) {
    throw new MarketplaceManifestError(
      `Marketplace manifest not found at ${resolved.manifestPath}`,
    );
  }
  const manifest = parseMarketplaceManifest(
    JSON.parse(fs.readFileSync(resolved.manifestPath, "utf-8")),
    // The registry key is the alias the user chose; the manifest name is only
    // cross-checked when a caller insists on one.
    registeredName,
  );
  if (isReservedMarketplaceName(manifest.name) && !isOfficialSource(source)) {
    throw new MarketplaceManifestError(
      `Marketplace ${manifest.name} may only be served from the official organization`,
    );
  }
  const entry: KnownMarketplace = {
    source,
    installLocation: path.resolve(resolved.manifestPath),
    lastUpdated: new Date().toISOString(),
    manifestDigest: manifestDigest(resolved.manifestPath),
  };
  rememberMarketplace(name, entry);
  return { marketplace: entry, manifest, reused: resolved.reused };
}

export interface MarketplaceRefresh {
  name: string;
  /** True when the manifest differs from the one recorded at the last read. */
  changed: boolean;
  updatedPlugins: { id: string; from: string; to: string }[];
  failed: { id: string; message: string }[];
}

export function manifestDigest(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Re-reads a marketplace and, unless asked not to, brings installed plugins up
 * to the version it now declares. The previous plugin list is read before the
 * refetch so a plugin that disappeared can be reported rather than silently
 * dropped from the summary.
 */
export async function refreshMarketplace(
  name: string,
  deps: MarketplaceDeps = createDefaultDeps(),
  options: { updatePlugins?: boolean } = {},
): Promise<MarketplaceRefresh> {
  const record = loadKnownMarketplaces()[name];
  if (!record) {
    throw new MarketplaceManifestError(`No marketplace named ${name}`);
  }
  // Resolved without the reuse shortcut: a refresh exists to see what changed.
  const resolved = await resolveMarketplaceSource(record.source, name, deps);
  if (!fs.existsSync(resolved.manifestPath)) {
    throw new MarketplaceManifestError(
      `Marketplace manifest not found at ${resolved.manifestPath}`,
    );
  }
  const manifest = parseMarketplaceManifest(
    JSON.parse(fs.readFileSync(resolved.manifestPath, "utf-8")),
  );
  rememberMarketplace(name, {
    ...record,
    installLocation: path.resolve(resolved.manifestPath),
    lastUpdated: new Date().toISOString(),
    manifestDigest: manifestDigest(resolved.manifestPath),
  });

  const summary: MarketplaceRefresh = {
    name,
    changed: manifestDigest(resolved.manifestPath) !== record.manifestDigest,
    updatedPlugins: [],
    failed: [],
  };

  if (options.updatePlugins === false) return summary;

  const suffix = `@${name}`;
  for (const [id, installations] of Object.entries(
    loadInstalledPlugins().plugins,
  )) {
    if (!id.endsWith(suffix)) continue;
    const pluginName = id.slice(0, id.length - suffix.length);
    const entry = manifest.plugins.find(
      (candidate) => candidate.name === pluginName,
    );
    if (!entry) continue;
    const target = entry.version ?? "0.0.0";
    const installed = installations[0]?.version;
    if (installed === target) continue;
    try {
      await installPlugin(name, pluginName, deps);
      summary.updatedPlugins.push({
        id,
        from: installed ?? "unknown",
        to: target,
      });
    } catch (error) {
      summary.failed.push({ id, message: (error as Error).message });
    }
  }
  return summary;
}
