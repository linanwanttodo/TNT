import fs from "fs";
import path from "path";

import { getPluginCacheDirectory } from "./directories.js";
import { parseMarketplaceManifest } from "./marketplaceManager.js";
import {
  loadInstalledPlugins,
  loadKnownMarketplaces,
  recordPluginInstallation,
  removePluginInstallation,
} from "./marketplaceRegistry.js";
import {
  MarketplaceDeps,
  ensureGitCheckout,
  githubUrls,
  unpackNpm,
} from "./marketplaceSources.js";
import { sanitizeSegment } from "./marketplaceTypes.js";

export class PluginInstallError extends Error {}

export interface InstalledPlugin {
  id: string;
  installPath: string;
  version: string;
  gitCommitSha?: string;
  reused: boolean;
}

/**
 * Where a plugin entry's `source` is read from. A relative path resolves inside
 * the marketplace that declared it; the remote forms reuse the fetch machinery
 * the marketplace layer already uses.
 */
function classifyPluginSource(source: string): {
  kind: "relative" | "github" | "git" | "npm";
  value: string;
} {
  if (source.startsWith("github:")) {
    return { kind: "github", value: source.slice("github:".length) };
  }
  if (source.startsWith("git:")) {
    return { kind: "git", value: source.slice("git:".length) };
  }
  if (source.startsWith("npm:")) {
    return { kind: "npm", value: source.slice("npm:".length) };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    throw new PluginInstallError(
      `Unsupported plugin source ${source}; supported forms are a relative path, github:<owner>/<repo>, git:<url> and npm:<package>`,
    );
  }
  return { kind: "relative", value: source };
}

function marketplaceRootOf(manifestPath: string): string {
  // The manifest normally sits at .claude-plugin/marketplace.json; a `file`
  // source points at that file directly, so one more level can be missing.
  const container = path.dirname(manifestPath);
  return path.basename(container) === ".claude-plugin"
    ? path.dirname(container)
    : container;
}

function installPathFor(
  marketplace: string,
  plugin: string,
  version: string,
): string {
  return path.join(
    getPluginCacheDirectory(),
    sanitizeSegment(marketplace),
    sanitizeSegment(plugin),
    sanitizeSegment(version),
  );
}

export async function installPlugin(
  marketplaceName: string,
  pluginName: string,
  deps: MarketplaceDeps,
): Promise<InstalledPlugin> {
  const marketplaces = loadKnownMarketplaces();
  const record = marketplaces[marketplaceName];
  if (!record) {
    throw new PluginInstallError(`No marketplace named ${marketplaceName}`);
  }
  if (!fs.existsSync(record.installLocation)) {
    throw new PluginInstallError(
      `Marketplace ${marketplaceName} is not fetched; re-add it to refresh`,
    );
  }
  const manifest = parseMarketplaceManifest(
    JSON.parse(fs.readFileSync(record.installLocation, "utf-8")),
  );
  const entry = manifest.plugins.find(
    (candidate) => candidate.name === pluginName,
  );
  if (!entry) {
    throw new PluginInstallError(
      `Marketplace ${marketplaceName} has no plugin named ${pluginName}`,
    );
  }

  const id = `${pluginName}@${marketplaceName}`;
  const version = entry.version ?? "0.0.0";
  const target = installPathFor(marketplaceName, pluginName, version);

  const already = loadInstalledPlugins().plugins[id]?.find(
    (candidate) => candidate.installPath === target,
  );
  if (already && fs.existsSync(target)) {
    return {
      id,
      installPath: target,
      version,
      gitCommitSha: already.gitCommitSha,
      reused: true,
    };
  }

  const { kind, value } = classifyPluginSource(entry.source);
  let gitCommitSha: string | undefined;

  if (kind === "relative") {
    const source = path.resolve(
      marketplaceRootOf(record.installLocation),
      value,
    );
    if (!fs.existsSync(source)) {
      throw new PluginInstallError(
        `Plugin source ${value} is missing from marketplace ${marketplaceName}`,
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  } else if (kind === "github" || kind === "git") {
    if (!deps.gitAvailable()) {
      throw new PluginInstallError(
        `Plugin ${id} needs git to be installed and on PATH`,
      );
    }
    const urls = kind === "github" ? githubUrls(value) : [value];
    await ensureGitCheckout(deps, urls, target, {});
    const head = await deps.run("git", ["rev-parse", "HEAD"], {
      cwd: target,
      env: {},
    });
    if (head.code === 0) gitCommitSha = head.stdout.trim();
  } else {
    const manifestPath = await unpackNpm(deps, value, target);
    const packageDir = path.dirname(manifestPath);
    if (path.basename(packageDir) === "package") {
      for (const child of fs.readdirSync(packageDir)) {
        fs.renameSync(path.join(packageDir, child), path.join(target, child));
      }
      fs.rmSync(packageDir, { recursive: true, force: true });
    }
  }

  recordPluginInstallation(id, {
    scope: "user",
    installPath: target,
    version,
    installedAt: new Date().toISOString(),
    gitCommitSha,
  });

  return { id, installPath: target, version, gitCommitSha, reused: false };
}

export interface InstallPlan {
  id: string;
  /** Every plugin that ended up installed, dependencies first. */
  installed: InstalledPlugin[];
}

function parseDependency(
  reference: string,
  defaultMarketplace: string,
): { name: string; marketplace: string } {
  const at = reference.lastIndexOf("@");
  if (at <= 0) return { name: reference, marketplace: defaultMarketplace };
  return {
    name: reference.slice(0, at),
    marketplace: reference.slice(at + 1),
  };
}

/**
 * Installs a plugin after its dependencies. A declaration may name another
 * marketplace, which is only allowed when the declaring marketplace lists that
 * marketplace in allowCrossMarketplaceDependenciesOn; anything else would let
 * one catalogue pull code from an unrelated one.
 */
export async function installPluginWithDependencies(
  marketplaceName: string,
  pluginName: string,
  deps: MarketplaceDeps,
): Promise<InstallPlan> {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: { marketplace: string; name: string; id: string }[] = [];

  const manifestFor = (marketplace: string) => {
    const record = loadKnownMarketplaces()[marketplace];
    if (!record) {
      throw new PluginInstallError(`No marketplace named ${marketplace}`);
    }
    if (!fs.existsSync(record.installLocation)) {
      throw new PluginInstallError(
        `Marketplace ${marketplace} is not fetched; re-add it to refresh`,
      );
    }
    return parseMarketplaceManifest(
      JSON.parse(fs.readFileSync(record.installLocation, "utf-8")),
    );
  };

  const visit = (marketplace: string, name: string, path: string[]): void => {
    const id = `${name}@${marketplace}`;
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new PluginInstallError(
        `Dependency cycle: ${[...path, id].join(" -> ")}`,
      );
    }
    const manifest = manifestFor(marketplace);
    const entry = manifest.plugins.find((candidate) => candidate.name === name);
    if (!entry) {
      throw new PluginInstallError(
        `Marketplace ${marketplace} has no plugin named ${name}`,
      );
    }
    visiting.add(id);
    for (const reference of entry.dependencies ?? []) {
      const dependency = parseDependency(reference, marketplace);
      if (
        dependency.marketplace !== marketplace &&
        !(manifest.allowCrossMarketplaceDependenciesOn ?? []).includes(
          dependency.marketplace,
        )
      ) {
        throw new PluginInstallError(
          `${id} depends on ${reference}, but ${marketplace} does not allow dependencies on ${dependency.marketplace}`,
        );
      }
      visit(dependency.marketplace, dependency.name, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
    order.push({ marketplace, name, id });
  };

  visit(marketplaceName, pluginName, []);

  const installed: InstalledPlugin[] = [];
  for (const step of order) {
    installed.push(await installPlugin(step.marketplace, step.name, deps));
  }
  return { id: `${pluginName}@${marketplaceName}`, installed };
}

export function uninstallPlugin(id: string): number {
  return removePluginInstallation(id);
}
