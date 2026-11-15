import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `core` grew a second runner because jest was added for ESM and never removed,
 * and for a year a suite's filename decided whether it ran at all. The collapse
 * deleted every jest dependency in the repository, which is the kind of fact
 * that silently becomes untrue again the moment one `npm i -D jest` lands.
 *
 * This walks the manifests rather than trusting the story: no package may
 * depend on jest, no `jest.config.*` may exist outside a vendored tree, and a
 * package that declares tests has to run them with vitest or say plainly that
 * it has none. The floors are assertions too - a scan that found no manifests
 * would agree with a repository that had no tests at all.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

/** Directories that ship their own dependency trees and are not ours to police.
 * Decided on the entry name, never on a joined path: `path.relative` returns
 * `core\node_modules\...` on Windows, and a `/`-based test there walks straight
 * into the dependencies it was meant to skip. */
const SKIP_DIRS = new Set(["node_modules", "dist", "vendor", "out", "build"]);

function manifests(): { file: string; json: any }[] {
  const roots = [repoRoot, path.join(repoRoot, "core")];
  for (const dir of fs.readdirSync(path.join(repoRoot, "packages"))) {
    const full = path.join(repoRoot, "packages", dir);
    if (!fs.existsSync(path.join(full, "package.json"))) continue;
    roots.push(full);
    for (const nested of fs.readdirSync(full)) {
      const inner = path.join(full, nested);
      if (fs.existsSync(path.join(inner, "package.json"))) roots.push(inner);
    }
  }

  const found: { file: string; json: any }[] = [];
  for (const dir of roots) {
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) continue;
    found.push({
      file: path.relative(repoRoot, file),
      json: JSON.parse(fs.readFileSync(file, "utf-8")),
    });
  }
  return found;
}

function jestConfigFiles(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^jest\.config\.(?:js|cjs|mjs|json|ts)$/.test(entry.name))
        hits.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  };
  walk(repoRoot);
  return hits;
}

describe("one test runner across the repository", () => {
  it("has no package depending on jest", () => {
    const list = manifests();
    expect(list.length).toBeGreaterThanOrEqual(8);

    const offenders = list
      .filter((entry) =>
        Object.keys({
          ...entry.json.dependencies,
          ...entry.json.devDependencies,
        }).some((name) => /(^|\/)jest$|ts-jest|@types\/jest/.test(name)),
      )
      .map((entry) => entry.file);
    expect(offenders).toEqual([]);
  });

  it("ships no jest configuration outside a vendored tree", () => {
    expect(jestConfigFiles()).toEqual([]);
  });

  it("runs its tests with vitest, or says it has none", () => {
    const declared: string[] = [];
    const offenders: string[] = [];
    for (const { file, json } of manifests()) {
      const script = json.scripts?.test;
      if (!script) continue;
      declared.push(`${file}: ${script}`);
      if (script.includes("vitest") || script.includes("No tests to run"))
        continue;
      offenders.push(`${file}: ${script}`);
    }
    // The floor is the number of test scripts seen, so an empty scan cannot
    // stand in for a repository where every package runs vitest.
    expect(declared.length).toBeGreaterThanOrEqual(8);
    expect(offenders).toEqual([]);
  });
});
