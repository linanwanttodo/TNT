import crypto from "crypto";
import * as fs from "fs";
import path from "path";

import { env } from "../config/env.js";

/**
 * A prebuilt, local-only map of the workspace. Building it walks the tree
 * instead of asking a model to explore, so the main agent starts a question
 * with the shape of the repository already known. The map is cached and only
 * rebuilt when the file inventory changes; no network, no remote code index.
 */

/** Directories that never describe the project's own shape. */
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
]);
/** Files that tell a reader where to start. */
const ENTRY_FILES = [
  "README.md",
  "AGENTS.md",
  "package.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "Makefile",
  "Dockerfile",
];
const MAX_DEPTH = 2;
const MAX_ENTRIES = 4000;
const MAX_DIRS_LISTED = 12;
const MAX_FILES_PER_DIR = 6;

export interface RepoMapEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/** A directory walk must not inventory its own cache, or every rebuild changes the fingerprint. */
function stateDirInside(root: string): string | undefined {
  const state = path.resolve(env.continueHome);
  return state !== root && state.startsWith(root + path.sep)
    ? state
    : undefined;
}

/** A bounded depth-first inventory, sorted so the same tree always hashes alike. */
export function inventoryWorkspace(root: string): RepoMapEntry[] {
  const entries: RepoMapEntry[] = [];
  const excludedDir = stateDirInside(root);
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
    let names: string[];
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIPPED_DIRS.has(name) || name.startsWith(".cache-")) continue;
      const full = path.join(dir, name);
      if (full === excludedDir) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1);
      } else if (stat.isFile()) {
        entries.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
        });
        if (entries.length >= MAX_ENTRIES) return;
      }
    }
  };
  walk(root, 0);
  return entries;
}

/** Changes only when a file is added, removed or touched. Sizes alone miss edits. */
export function inventoryFingerprint(entries: readonly RepoMapEntry[]): string {
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    hash.update(`${entry.path}|${entry.size}|${entry.mtimeMs}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

/** The compact text the model reads. Paths only: no file contents, no secrets. */
export function renderRepoMap(
  root: string,
  entries: readonly RepoMapEntry[],
): string {
  const lines: string[] = [
    `Workspace: ${root} (${entries.length} files inventoried, depth <= ${MAX_DEPTH})`,
  ];
  const present = ENTRY_FILES.filter((name) =>
    entries.some((entry) => entry.path === name),
  );
  if (present.length > 0) {
    lines.push(`Entry points: ${present.join(", ")}`);
  }
  const byDir = new Map<string, string[]>();
  for (const entry of entries) {
    const dir = path.posix.dirname(entry.path);
    const list = byDir.get(dir) ?? [];
    list.push(path.posix.basename(entry.path));
    byDir.set(dir, list);
  }
  const dirs = [...byDir.keys()].sort();
  for (const dir of dirs.slice(0, MAX_DIRS_LISTED)) {
    const files = (byDir.get(dir) ?? []).sort();
    const listed = files.slice(0, MAX_FILES_PER_DIR);
    const suffix = files.length > listed.length ? ", ..." : "";
    const label = dir === "." ? "." : `${dir}/`;
    lines.push(`${label} ${files.length} files: ${listed.join(", ")}${suffix}`);
  }
  if (dirs.length > MAX_DIRS_LISTED) {
    lines.push(`(+ ${dirs.length - MAX_DIRS_LISTED} more directories)`);
  }
  lines.push("Paths are relative to the workspace root.");
  return lines.join("\n");
}

interface CachedMap {
  version: 1;
  fingerprint: string;
  map: string;
}

function cacheFileFor(root: string): string {
  const key = crypto
    .createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 16);
  return path.join(env.continueHome, "repo-map", `${key}.json`);
}

function readCache(file: string): CachedMap | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as CachedMap;
    if (parsed.version === 1 && typeof parsed.map === "string") {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface RepoMapResult {
  map: string;
  fingerprint: string;
  rebuilt: boolean;
}

/**
 * Returns the map for `root`, rebuilding it only when the inventory moved.
 * A fresh build writes the cache for the next turn; a warm cache costs one
 * directory walk and no model tokens.
 */
export function localRepoMap(root: string): RepoMapResult {
  const absolute = path.resolve(root);
  const entries = inventoryWorkspace(absolute);
  const fingerprint = inventoryFingerprint(entries);
  const file = cacheFileFor(absolute);
  const cached = readCache(file);
  if (cached?.fingerprint === fingerprint) {
    return { map: cached.map, fingerprint, rebuilt: false };
  }
  const map = renderRepoMap(absolute, entries);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, fingerprint, map }), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // A read-only home still gets the map for this turn; only persistence is lost.
  }
  return { map, fingerprint, rebuilt: true };
}

/** Clear the cached map for a root, so a test can start from a cold cache. */
export function forgetRepoMap(root: string): void {
  try {
    fs.rmSync(cacheFileFor(path.resolve(root)), { force: true });
  } catch {
    // Nothing cached is a valid cold state.
  }
}

/** True when the workspace is big enough that exploring it costs real tokens. */
export function isLargeWorkspace(root: string): boolean {
  return inventoryWorkspace(path.resolve(root)).length >= 200;
}
