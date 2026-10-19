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
 * Two shapes are collected, because they fail differently. A path with a source
 * extension names a file, so it must resolve to tracked source. A path without
 * one names a place - a directory, or a file written extension-less - and that is
 * how the two wrong sentences this guard was built around slipped past the first
 * version: `src/integration-tests/` and `src/tools/mcpToolsFromConnections` were
 * both invisible to an extension-only pattern.
 *
 * A named place is also the only way the notes can talk about a removal, so the
 * second list below is asserted the other way round: an entry there must NOT
 * resolve, which catches the directory coming back while the note still says it is
 * gone.
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

/**
 * Build output and somebody else's tree: neither is tracked source, and a fresh
 * clone may legitimately have no `dist` at all, so a mention of either decides
 * nothing in either direction.
 */
const UNTRACKED_PREFIXES = ["dist/", "node_modules/"];

/**
 * Places the notes name in order to say they are gone. Asserted absent, so a
 * recreation does not leave the sentence behind as a lie.
 */
const REMOVED_PLACES: string[] = ["src/test-utils"];

const DOCUMENTED_PATH =
  /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml))`/g;

const DOCUMENTED_PLACE = /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\/?)`/g;

const HAS_EXTENSION = /\.(tsx?|jsx?|mjs|cjs|json|md|ya?ml|py|sh|env)$/i;

/**
 * Anything with a shell variable, a glob, a placeholder, a space, a home prefix
 * or a scheme is a pattern or an instruction rather than a name to look up.
 */
const NOT_A_NAME = /[$<{*~ ]|:\/\//;

function resolve(candidate: string): boolean {
  return ROOTS.some((root) => {
    const full = path.resolve(root, candidate);
    return full.startsWith(repoRoot) && fs.existsSync(full);
  });
}

function existsAsFile(candidate: string): boolean {
  return ROOTS.some((root) => {
    const full = path.resolve(root, candidate);
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

function isGenerated(candidate: string): boolean {
  return ["dist/index.js", "dist/tnt.js"].some(
    (g) => candidate === g || candidate.endsWith(`/${g}`),
  );
}

function scan(): {
  paths: Map<string, string>;
  places: Map<string, string>;
} {
  const paths = new Map<string, string>();
  const places = new Map<string, string>();
  for (const doc of DOCS) {
    const text = fs.readFileSync(doc, "utf8");
    for (const match of text.matchAll(DOCUMENTED_PATH)) {
      if (!paths.has(match[1])) paths.set(match[1], doc);
    }
    for (const match of text.matchAll(DOCUMENTED_PLACE)) {
      const candidate = match[1].replace(/\/$/, "");
      if (
        paths.has(candidate) ||
        paths.has(`${candidate}.ts`) ||
        HAS_EXTENSION.test(candidate) ||
        NOT_A_NAME.test(candidate) ||
        candidate.startsWith("/") ||
        UNTRACKED_PREFIXES.some(
          (prefix) =>
            candidate.startsWith(prefix) || candidate.includes(`/${prefix}`),
        )
      ) {
        continue;
      }
      if (!places.has(candidate)) places.set(candidate, doc);
    }
  }
  return { paths, places };
}

describe("the architecture notes name files that exist", () => {
  const { paths, places } = scan();
  const present = [...paths.keys()].filter(existsAsFile);
  const external = [...paths.keys()].filter(
    (p) => !existsAsFile(p) && !isGenerated(p) && EXTERNAL_PATHS.includes(p),
  );
  const offenders = [...paths.keys()].filter(
    (p) => !existsAsFile(p) && !isGenerated(p) && !EXTERNAL_PATHS.includes(p),
  );

  const standingPlaces = [...places.keys()].filter(resolve);
  const removedPlaces = [...places.keys()].filter(
    (p) => !resolve(p) && REMOVED_PLACES.includes(p),
  );
  const placeOffenders = [...places.keys()].filter(
    (p) => !resolve(p) && !REMOVED_PLACES.includes(p),
  );

  it("reads a document that really carries the paths it is meant to check", () => {
    // Without this, a scan that found nothing - a moved doc, a broken pattern -
    // would report a clean repository.
    expect(present.length + external.length + offenders.length).toBeGreaterThan(
      80,
    );
    expect(
      standingPlaces.length + removedPlaces.length + placeOffenders.length,
    ).toBeGreaterThan(15);
    for (const doc of DOCS) {
      expect(fs.existsSync(doc), doc).toBe(true);
    }
  });

  it("names only paths the docs still mention, so no list goes stale", () => {
    for (const entry of [...EXTERNAL_PATHS, ...REMOVED_PLACES]) {
      expect(
        paths.has(entry) || paths.has(`${entry}.ts`) || places.has(entry),
        entry,
      ).toBe(true);
    }
  });

  it("resolves or accounts for every documented path", () => {
    expect(offenders).toEqual([]);
  });

  it("resolves every named place except the removals it declares", () => {
    expect(placeOffenders).toEqual([]);
    // The removal claims, held the other way round: the note says the directory
    // is gone, so it may not come back unnoticed.
    expect(removedPlaces.length).toBeGreaterThan(0);
    for (const entry of REMOVED_PLACES) {
      expect(resolve(entry), entry).toBe(false);
    }
  });
});
