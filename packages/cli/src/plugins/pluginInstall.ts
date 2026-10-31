import fs from "fs";
import path from "path";

import { t } from "../i18n/index.js";

import { getPluginCacheDirectory } from "./directories.js";
import { invalidatePluginCache } from "./loader.js";
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
  githubCloneUrls,
  unpackNpm,
} from "./marketplaceSources.js";
import { PluginSource, sanitizeSegment } from "./marketplaceTypes.js";

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
 * the marketplace layer already uses. The object forms are what a catalogue
 * written for the reference tool uses, so both spellings are accepted.
 */
function classifyPluginSource(source: PluginSource): {
  kind: "relative" | "github" | "git" | "gitSubdir" | "npm";
  value: string;
  ref?: string;
  subPath?: string;
} {
  if (typeof source !== "string") {
    const detail = source as Record<string, unknown>;
    switch (detail.source) {
      case "npm":
        if (typeof detail.package !== "string" || !detail.package) {
          throw new PluginInstallError(t("plugins.npmNeedsPackage"));
        }
        return { kind: "npm", value: detail.package };
      case "github":
        if (typeof detail.repo !== "string" || !detail.repo) {
          throw new PluginInstallError(t("plugins.githubNeedsRepo"));
        }
        return {
          kind: "github",
          value: detail.repo,
          ref: typeof detail.ref === "string" ? detail.ref : undefined,
        };
      case "url":
        if (typeof detail.url !== "string" || !detail.url) {
          throw new PluginInstallError(t("plugins.urlNeedsUrl"));
        }
        // A url source is fetched as a git repository, which is what the name
        // means wherever it appears.
        return {
          kind: "git",
          value: detail.url,
          ref: typeof detail.ref === "string" ? detail.ref : undefined,
        };
      case "git-subdir":
        if (
          typeof detail.url !== "string" ||
          typeof detail.path !== "string" ||
          !detail.url ||
          !detail.path
        ) {
          throw new PluginInstallError(t("plugins.gitSubdirNeedsUrlAndPath"));
        }
        return {
          kind: "gitSubdir",
          value: detail.url,
          ref: typeof detail.ref === "string" ? detail.ref : undefined,
          subPath: detail.path,
        };
      case "pip":
        throw new PluginInstallError(t("plugins.pipUnsupported"));
      default:
        throw new PluginInstallError(
          t("plugins.unsupportedSourceType", { type: String(detail.source) }),
        );
    }
  }

  if (source.startsWith("github:")) {
    return { kind: "github", value: source.slice("github:".length) };
  }
  if (source.startsWith("git:")) {
    return { kind: "git", value: source.slice("git:".length) };
  }
  if (source.startsWith("url:")) {
    return { kind: "git", value: source.slice("url:".length) };
  }
  if (source.startsWith("npm:")) {
    return { kind: "npm", value: source.slice("npm:".length) };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    throw new PluginInstallError(t("plugins.unsupportedSource", { source }));
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
    throw new PluginInstallError(
      t("plugins.noMarketplace", { name: marketplaceName }),
    );
  }
  if (!fs.existsSync(record.installLocation)) {
    throw new PluginInstallError(
      t("plugins.marketplaceNotFetched", { name: marketplaceName }),
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
      t("plugins.marketplaceHasNoPlugin", {
        marketplace: marketplaceName,
        plugin: pluginName,
      }),
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

  const { kind, value, ref, subPath } = classifyPluginSource(entry.source);
  let gitCommitSha: string | undefined;

  if (kind === "relative") {
    const source = path.resolve(
      marketplaceRootOf(record.installLocation),
      value,
    );
    if (!fs.existsSync(source)) {
      throw new PluginInstallError(
        t("plugins.sourceMissing", {
          source: value,
          marketplace: marketplaceName,
        }),
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  } else if (kind === "github" || kind === "git" || kind === "gitSubdir") {
    if (!deps.gitAvailable()) {
      throw new PluginInstallError(t("plugins.needsGit", { id }));
    }
    const urls =
      kind === "github" ? await githubCloneUrls(deps, value) : [value];
    // A subdirectory source is cloned somewhere temporary and then reduced to
    // the directory the manifest named.
    const cloneTarget = subPath
      ? path.join(path.dirname(target), `${path.basename(target)}.tmp-clone`)
      : target;
    await ensureGitCheckout(deps, urls, cloneTarget, { ref });
    if (subPath) {
      const inner = path.join(cloneTarget, subPath);
      if (!fs.existsSync(inner)) {
        fs.rmSync(cloneTarget, { recursive: true, force: true });
        throw new PluginInstallError(
          t("plugins.subdirMissing", { id, path: subPath }),
        );
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(inner, target, { recursive: true });
      fs.rmSync(cloneTarget, { recursive: true, force: true });
    }
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

  invalidatePluginCache();
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
      throw new PluginInstallError(
        t("plugins.noMarketplace", { name: marketplace }),
      );
    }
    if (!fs.existsSync(record.installLocation)) {
      throw new PluginInstallError(
        t("plugins.marketplaceNotFetched", { name: marketplace }),
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
        t("plugins.dependencyCycle", { path: [...path, id].join(" -> ") }),
      );
    }
    const manifest = manifestFor(marketplace);
    const entry = manifest.plugins.find((candidate) => candidate.name === name);
    if (!entry) {
      throw new PluginInstallError(
        t("plugins.marketplaceHasNoPlugin", {
          marketplace,
          plugin: name,
        }),
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
          t("plugins.dependencyNotAllowed", {
            id,
            reference,
            marketplace,
            target: dependency.marketplace,
          }),
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
  const removed = removePluginInstallation(id);
  invalidatePluginCache();
  return removed;
}
