#!/usr/bin/env node
/**
 * Guard against stale build artifacts ("老代码带入").
 *
 * The CLI bundler aliases @tnt/* to each package's dist/index.js, and the
 * zcode-ui TS project references consume @zcode/services' dist/.d.ts — so a
 * dist older than its src silently ships old code / lies about types. This
 * script walks those packages, compares newest src mtime against newest dist
 * mtime, and rebuilds anything stale (or missing) BEFORE the CLI build runs.
 * It is wired as a prebuild/pretypecheck hook so a plain `npm run build`
 * can never bundle yesterday's artifacts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../..");

// Packages whose dist is consumed by the CLI bundler or by TS project refs.
// Every entry must have a "build" script in its own package.json.
const TARGETS = [
  { name: "config-types", dir: "packages/config-types" },
  { name: "fetch", dir: "packages/fetch" },
  { name: "llm-info", dir: "packages/llm-info" },
  { name: "terminal-security", dir: "packages/terminal-security" },
  { name: "config-yaml", dir: "packages/config-yaml" },
  { name: "openai-adapters", dir: "packages/openai-adapters" },
  { name: "core", dir: "core" },
  { name: "@zcode/services (types)", dir: "packages/zcode-ui/services" },
];

/** Newest mtime of files under dir (recursive, skipping node_modules). */
function newestMtime(dir, skipNodeModules = true) {
  let newest = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipNodeModules && entry.name === "node_modules") continue;
        walk(join(current, entry.name));
      } else {
        const mtime = statSync(join(current, entry.name)).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  };
  if (!existsSync(dir)) return newest;
  walk(dir);
  return newest;
}

function main() {
  const rebuilt = [];
  const failures = [];

  for (const target of TARGETS) {
    const pkgDir = resolve(REPO, target.dir);
    const pkgJsonPath = join(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) {
      failures.push(`${target.name}: package.json not found at ${pkgDir}`);
      continue;
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    if (!pkg.scripts?.build) {
      // No build script → nothing to refresh; report loudly instead of silently skipping.
      failures.push(`${target.name}: no "build" script in package.json`);
      continue;
    }

    const srcNewest = newestMtime(join(pkgDir, "src"));
    const distNewest = newestMtime(join(pkgDir, "dist"));
    const stale = distNewest === 0 || (srcNewest > 0 && srcNewest > distNewest);
    if (!stale) continue;

    console.log(`[ensure-fresh-deps] rebuilding stale ${target.name} ...`);
    const result = spawnSync("npm", ["run", "build", "--prefix", pkgDir], {
      stdio: "inherit",
      shell: false,
    });
    if (result.status !== 0) {
      failures.push(`${target.name}: rebuild failed (exit ${result.status})`);
    } else {
      rebuilt.push(target.name);
    }
  }

  if (rebuilt.length > 0) {
    console.log(`[ensure-fresh-deps] refreshed: ${rebuilt.join(", ")}`);
  } else {
    console.log("[ensure-fresh-deps] all artifacts are up to date");
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[ensure-fresh-deps] ${failure}`);
    }
    process.exit(1);
  }
}

main();
