import fs from "fs";
import os from "os";
import path from "path";

import { getMarketplacesDirectory } from "./directories.js";
import {
  KnownMarketplace,
  MarketplaceSource,
  isSameSource,
  sanitizeSegment,
} from "./marketplaceTypes.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
) => Promise<CommandResult>;

export type FetchJson = (
  url: string,
  headers: Record<string, string>,
) => Promise<unknown>;

export interface MarketplaceDeps {
  run: CommandRunner;
  fetchJson: FetchJson;
  gitAvailable: () => boolean;
  sshConfiguredForGitHub: () => Promise<boolean>;
}

export interface ResolvedMarketplace {
  /** Absolute path of the marketplace manifest on disk. */
  manifestPath: string;
  /** Directory the registry may clean up for this marketplace. */
  cacheDir: string;
  /** True when an existing checkout was reused instead of re-fetched. */
  reused: boolean;
}

export class MarketplaceFetchError extends Error {}

/**
 * No interactive credential prompts, and no silently trusting a host key: a
 * marketplace fetch runs in the background, so a prompt would hang the session
 * and an auto-accepted key would be a credential leak on a name we did not
 * choose.
 */
export const GIT_NO_PROMPT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND:
    "ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes",
};

const MANIFEST_RELPATH = path.join(".claude-plugin", "marketplace.json");

function marketplacesRoot(): string {
  return getMarketplacesDirectory();
}

export function marketplaceCacheDir(name: string): string {
  return path.join(marketplacesRoot(), sanitizeSegment(name));
}

async function gitClone(
  deps: MarketplaceDeps,
  url: string,
  target: string,
  source: { ref?: string; sparsePaths?: string[] },
): Promise<CommandResult> {
  const args = ["clone", "--depth", "1"];
  if (source.ref) args.push("--branch", source.ref);
  if (source.sparsePaths?.length) {
    args.push("--filter=blob:none", "--no-checkout");
  } else {
    args.push("--recurse-submodules", "--shallow-submodules");
  }
  args.push(url, target);
  const cloned = await deps.run("git", args, {
    env: GIT_NO_PROMPT_ENV,
    cwd: path.dirname(target),
  });
  if (cloned.code !== 0 || !source.sparsePaths?.length) return cloned;
  await deps.run(
    "git",
    ["sparse-checkout", "set", "--cone", "--", ...source.sparsePaths],
    { env: GIT_NO_PROMPT_ENV, cwd: target },
  );
  return deps.run("git", ["checkout", "HEAD"], {
    env: GIT_NO_PROMPT_ENV,
    cwd: target,
  });
}

/** Pull first; a checkout that cannot be updated is replaced, not abandoned. */
async function ensureGitCheckout(
  deps: MarketplaceDeps,
  urls: string[],
  target: string,
  source: { ref?: string; sparsePaths?: string[] },
): Promise<{ reused: boolean }> {
  if (fs.existsSync(path.join(target, ".git"))) {
    const ref = source.ref ?? "HEAD";
    const pulled = await deps.run(
      "git",
      ["pull", "--depth", "1", "origin", ref],
      {
        env: GIT_NO_PROMPT_ENV,
        cwd: target,
      },
    );
    if (pulled.code === 0) return { reused: true };
    fs.rmSync(target, { recursive: true, force: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  let last: CommandResult | null = null;
  for (const url of urls) {
    last = await gitClone(deps, url, target, source);
    if (last.code === 0) return { reused: false };
    fs.rmSync(target, { recursive: true, force: true });
  }
  throw new MarketplaceFetchError(
    `Could not fetch marketplace: ${(last?.stderr || "no attempt made").trim()}`,
  );
}

function gitUrls(source: { url: string; ref?: string }): string[] {
  return [source.url];
}

function githubUrls(repo: string): string[] {
  return [`git@github.com:${repo}.git`, `https://github.com/${repo}.git`];
}

async function fetchToCache(
  deps: MarketplaceDeps,
  url: string,
  headers: Record<string, string>,
  cacheDir: string,
): Promise<string> {
  const payload = await deps.fetchJson(url, {
    "User-Agent": "TNT-Plugin-Manager",
    ...headers,
  });
  const manifestPath = path.join(cacheDir, MANIFEST_RELPATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
  return manifestPath;
}

async function unpackNpm(
  deps: MarketplaceDeps,
  pkg: string,
  cacheDir: string,
): Promise<string> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-npm-"));
  try {
    const packed = await deps.run("npm", ["pack", pkg, "--json"], {
      cwd: workDir,
      env: {},
    });
    if (packed.code !== 0) {
      throw new MarketplaceFetchError(
        `npm pack failed for ${pkg}: ${packed.stderr.trim() || packed.stdout.trim()}`,
      );
    }
    const archive =
      parseNpmPackFilename(packed.stdout) ??
      fs
        .readdirSync(workDir)
        .filter((f) => f.endsWith(".tgz"))
        .sort()
        .pop();
    if (!archive) {
      throw new MarketplaceFetchError(
        `npm pack produced no archive for ${pkg}`,
      );
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    const extracted = await deps.run(
      "tar",
      ["-xzf", path.join(workDir, archive), "-C", cacheDir],
      { cwd: cacheDir, env: {} },
    );
    if (extracted.code !== 0) {
      throw new MarketplaceFetchError(
        `Could not unpack ${archive}: ${extracted.stderr.trim()}`,
      );
    }
    return path.join(cacheDir, "package", MANIFEST_RELPATH);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function parseNpmPackFilename(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const name = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;
    return typeof name === "string" ? name : null;
  } catch {
    // Older npm prints a bare filename rather than JSON.
    return /^\S+\.tgz$/.test(trimmed) ? trimmed : null;
  }
}

/**
 * Resolve a marketplace source to a manifest path on disk. `existing` lets an
 * unchanged checkout skip the network entirely.
 */
export async function resolveMarketplaceSource(
  source: MarketplaceSource,
  name: string,
  deps: MarketplaceDeps,
  existing?: KnownMarketplace,
): Promise<ResolvedMarketplace> {
  const cacheDir = marketplaceCacheDir(name);
  const reusedCheckout =
    isSameSource(existing?.source, source) && fs.existsSync(cacheDir);

  switch (source.source) {
    case "file": {
      const absolute = path.resolve(source.path);
      return {
        manifestPath: absolute,
        cacheDir: path.dirname(path.dirname(absolute)),
        reused: true,
      };
    }
    case "directory": {
      const absolute = path.resolve(source.path);
      return {
        manifestPath: path.join(absolute, MANIFEST_RELPATH),
        cacheDir: absolute,
        reused: true,
      };
    }
    case "url": {
      if (reusedCheckout && existing) {
        const cached = path.join(existing.installLocation);
        if (fs.existsSync(cached)) {
          return { manifestPath: cached, cacheDir, reused: true };
        }
      }
      const manifestPath = await fetchToCache(
        deps,
        source.url,
        source.headers ?? {},
        cacheDir,
      );
      return { manifestPath, cacheDir, reused: false };
    }
    case "github": {
      if (!deps.gitAvailable()) {
        throw new MarketplaceFetchError(
          "git is not installed, so a github marketplace cannot be fetched",
        );
      }
      const candidates = (await deps.sshConfiguredForGitHub())
        ? githubUrls(source.repo)
        : [githubUrls(source.repo)[1], githubUrls(source.repo)[0]];
      const { reused } = await ensureGitCheckout(deps, candidates, cacheDir, {
        ref: source.ref,
        sparsePaths: source.sparsePaths,
      });
      const manifestPath = source.path
        ? path.join(cacheDir, source.path)
        : path.join(cacheDir, MANIFEST_RELPATH);
      return { manifestPath, cacheDir, reused };
    }
    case "git": {
      if (!deps.gitAvailable()) {
        throw new MarketplaceFetchError(
          "git is not installed, so a git marketplace cannot be fetched",
        );
      }
      const { reused } = await ensureGitCheckout(
        deps,
        gitUrls(source),
        cacheDir,
        { ref: source.ref, sparsePaths: source.sparsePaths },
      );
      const manifestPath = source.path
        ? path.join(cacheDir, source.path)
        : path.join(cacheDir, MANIFEST_RELPATH);
      return { manifestPath, cacheDir, reused };
    }
    case "npm": {
      const manifestPath = await unpackNpm(deps, source.package, cacheDir);
      return { manifestPath, cacheDir, reused: false };
    }
  }
}
