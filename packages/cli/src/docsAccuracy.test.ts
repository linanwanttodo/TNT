import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * Both architecture notes make a checkable promise - the longer one says it out
 * loud: "Every statement here names a file that exists in this repository." A
 * claim like that rots the moment a file is renamed, and nothing in the gate set
 * notices, because a doc is not a build input.
 *
 * So the claim is run instead of trusted: every backticked path with a source
 * extension is resolved, and anything that is not a file of this repository has
 * to be one of the named external locations below.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

const DOCS = [
  path.join(packageRoot, "ARCHITECTURE-tnt.md"),
  path.join(packageRoot, "docs", "ARCHITECTURE-tnt.md"),
];

/**
 * The notes name a file from whichever directory reads closest to them: relative
 * to the package, to the repository, to the core engine the CLI drives, and to
 * the two roots their test helpers sit under.
 */
const ROOTS = [
  packageRoot,
  repoRoot,
  path.join(repoRoot, "core"),
  path.join(repoRoot, "packages"),
  path.join(packageRoot, "src"),
  path.join(packageRoot, "test-utils"),
];

/**
 * Paths the docs describe rather than ship: settings locations the CLI reads
 * from a user's own tree, and files a plugin is expected to carry. An entry may
 * only leave this list by becoming a real file of this repository.
 */
const EXTERNAL_PATHS: string[] = [
  ".claude/settings.json",
  ".tnt/settings.json",
  ".claude-plugin/plugin.json",
  "agents/review.md",
];

const DOCUMENTED_PATH =
  /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml))`/g;

/**
 * `dist` is what `npm run build` produces, so the notes may name the bundle
 * without that being a claim about tracked source. It is neither proof nor an
 * error, and an entry is only useful while the docs still mention it.
 */
const GENERATED_PATHS: string[] = ["dist/index.js", "dist/tnt.js"];

function isGenerated(candidate: string): boolean {
  return GENERATED_PATHS.some(
    (g) => candidate === g || candidate.endsWith(`/${g}`),
  );
}

function existsAsFile(candidate: string): boolean {
  return ROOTS.some((root) => {
    const full = path.resolve(root, candidate);
    // Only inside this repository: `dist` is a build output and `node_modules`
    // is somebody else's tree, so neither may decide the verdict.
    if (!full.startsWith(repoRoot)) {
      return false;
    }
    const parts = full.split(path.sep);
    if (parts.includes("node_modules") || parts.includes("dist")) {
      return false;
    }
    return fs.existsSync(full) && fs.statSync(full).isFile();
  });
}

function scanDocs(): Map<string, string> {
  const found = new Map<string, string>();
  for (const doc of DOCS) {
    const text = fs.readFileSync(doc, "utf8");
    for (const match of text.matchAll(DOCUMENTED_PATH)) {
      if (!found.has(match[1])) found.set(match[1], doc);
    }
  }
  return found;
}

describe("the architecture notes name files that exist", () => {
  const documented = scanDocs();
  const present = [...documented.keys()].filter(existsAsFile);
  const external = [...documented.keys()].filter(
    (p) => !existsAsFile(p) && !isGenerated(p) && EXTERNAL_PATHS.includes(p),
  );
  const offenders = [...documented.keys()].filter(
    (p) => !existsAsFile(p) && !isGenerated(p) && !EXTERNAL_PATHS.includes(p),
  );

  it("reads a document that really carries the paths it is meant to check", () => {
    // Without this, a scan that found nothing - a moved doc, a broken pattern -
    // would report a clean repository.
    expect(present.length + external.length + offenders.length).toBeGreaterThan(
      80,
    );
    for (const doc of DOCS) {
      expect(fs.existsSync(doc), doc).toBe(true);
    }
  });

  it("names only paths the docs still mention, so no list goes stale", () => {
    for (const entry of [...EXTERNAL_PATHS, ...GENERATED_PATHS]) {
      expect(documented.has(entry), entry).toBe(true);
    }
  });

  it("resolves or accounts for every documented path", () => {
    expect(offenders).toEqual([]);
  });
});
