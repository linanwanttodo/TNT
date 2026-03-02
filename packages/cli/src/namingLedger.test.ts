import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The product is TNT, and `Continue` survived in the tree as both a brand in copy and a
 * prefix on identifiers. Renaming all of it in one sweep is how a branding change ends up
 * half-done: the files that were missed keep working, so nothing reports them.
 *
 * The ledger below totals 341 tokens across the seven areas that still hold one. It is the number to drive down,
 * area by area, with two deliberate holds: `packages/sdk` is dominated by the generated
 * OpenAPI client for the operator's platform API, whose names are the remote contract the
 * generator emits, and a sentence in the past tense about the upstream project stays
 * spelled the way history spells it.
 *
 * This guard holds two things. The first is zero tolerance for the three names the engine
 * reads off disk (`.continueignore`, `.continuerules`, `.continuerc.json`) - those were
 * renamed to `.tntignore`, `.tntrules` and `.tntrc.json`, and a reintroduced old name is a
 * silent behavioral bug, not a cosmetic slip, because the old file stops being read. The
 * second is a frozen per-area count of the remaining `Continue` tokens, compared by
 * equality, so debt can only move down and a new offender shows up as its own area's number.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const SKIP_DIRECTORIES = [
  "node_modules",
  "dist",
  "out",
  "build",
  "bin",
  "vendor",
  ".next",
  "coverage",
  "analysis",
  "media",
];
const SKIP_FILENAMES = ["package-lock.json", "CHANGELOG.md"];
const SCAN_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "md",
  "mdx",
  "json",
  "yaml",
  "yml",
  "sh",
  "ps1",
  "py",
  "html",
]);

/** The disk names the engine reads, which must no longer appear anywhere. */
export const RENAMED_DISK_NAMES = [
  "continueignore",
  "continuerules",
  "continuerc",
];

// This file has to name the strings it hunts, so it would otherwise report
// itself as an offender on every run.
const self = path.relative(repoRoot, fileURLToPath(import.meta.url));

/**
 * Tracked files only. A walk of the working tree counts whatever the local
 * machine has lying around - a build artifact written into the package was
 * worth six tokens here and nothing on a fresh checkout, so the frozen numbers
 * disagreed with CI about the same commit.
 */
function scannedFiles(): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString()
    .split("\0")
    .filter(Boolean);

  return tracked
    .filter((relative) => {
      const segments = relative.split("/");
      const name = segments[segments.length - 1];
      if (SKIP_FILENAMES.includes(name)) return false;
      if (segments[0].startsWith(".") || SKIP_DIRECTORIES.includes(segments[0]))
        return false;
      const extension = name.includes(".") ? name.split(".").pop() : undefined;
      return !!extension && SCAN_EXTENSIONS.has(extension);
    })
    .map((relative) => path.join(repoRoot, relative));
}

/** Group by the unit a reviewer owns: one per package, one per top area. */
function areaOf(file: string): string {
  const segments = path.relative(repoRoot, file).split(path.sep);
  if (segments[0] === "packages") return `packages/${segments[1] ?? "misc"}`;
  if (["docs-site", "docs", "core"].includes(segments[0])) return segments[0];
  return segments.length > 1 ? segments[0] : "(root)";
}

export function continueTokenLedger(): {
  counts: Record<string, number>;
  filesScanned: number;
  staleDiskNames: string[];
} {
  const counts: Record<string, number> = {};
  const staleDiskNames: string[] = [];
  const files = scannedFiles();

  for (const file of files) {
    if (path.relative(repoRoot, file) === self) continue;
    let source: string;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const hits = source.split("Continue").length - 1;
    if (hits > 0) counts[areaOf(file)] = (counts[areaOf(file)] ?? 0) + hits;
    for (const stale of RENAMED_DISK_NAMES) {
      if (source.includes(stale)) {
        staleDiskNames.push(`${path.relative(repoRoot, file)} :: ${stale}`);
      }
    }
  }

  return { counts, filesScanned: files.length, staleDiskNames };
}

/**
 * Recomputed from the tree, never hand-edited: every rename slice lowers one of these
 * numbers and the diff shows which area paid.
 */
const FROZEN_LEDGER: Record<string, number> = {
  "(root)": 9,
  core: 60,
  "packages/cli": 59,
  "packages/config-yaml": 7,
  "packages/llm-info": 1,
  "packages/sdk": 203,
  scripts: 2,
};

describe("the naming ledger", () => {
  const ledger = continueTokenLedger();

  it("scans the tree it claims to scan", () => {
    // An empty walk would agree with an empty ledger.
    expect(ledger.filesScanned).toBeGreaterThan(2000);
  });

  it("keeps the renamed disk names out of the tree", () => {
    expect(ledger.staleDiskNames).toEqual([]);
  });

  it("pays the Continue debt down from a frozen per-area count", () => {
    expect(ledger.counts).toEqual(FROZEN_LEDGER);
    const total = Object.values(ledger.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.values(FROZEN_LEDGER).reduce((a, b) => a + b, 0));
  });
});
