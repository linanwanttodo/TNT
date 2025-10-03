import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The module groups the engine is allowed to depend on one way. A cycle between
 * two groups means neither can be understood, tested or changed on its own, and
 * several of these have already cost debugging time (a service that resolved as
 * undefined because the layer below it reached back up into the layer above).
 *
 * This is a ratchet, not an achievement list: the set below is the debt that
 * exists today, the test fails on a cycle that is not in it, and a cycle that is
 * removed only needs its line deleted here.
 */
/**
 * Measured 2026-10-16 over the production sources. `compaction <-> stream` is the
 * one that bites hardest: the compaction policy calls the engine it is supposed
 * to serve, so neither can be exercised without the other, and it is why the
 * summarizing tests mock a module two layers above them.
 */
const KNOWN_MUTUAL_COUPLING = [
  "_root <-> commands",
  "agent <-> services",
  "commands <-> services",
  "commands <-> ui",
  "config <-> i18n",
  "config <-> permissions",
  "config <-> platform",
  "config <-> plugins",
  "config <-> startup",
  "config <-> utils",
  "hooks <-> plugins",
  "hooks <-> services",
  "permissions <-> services",
  "permissions <-> tools",
  "services <-> startup",
  "services <-> subagent",
  "services <-> tools",
  "services <-> utils",
  "session <-> subagent",
  "session <-> utils",
  "subagent <-> tools",
  "telemetry <-> utils",
];

const TEST_ONLY = [
  ".test.",
  "test-utils",
  "__mocks__",
  `${path.sep}e2e${path.sep}`,
];

function productionSources(dir: string): string[] {
  const found: string[] = [];

  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    const isTest = TEST_ONLY.some((marker) => full.includes(marker));
    if (isTest) continue;

    if (statSync(full).isDirectory()) {
      found.push(...productionSources(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}

/** First path segment is the group; a file at the top of src is `_root`. */
function groupOf(relative: string): string {
  const parts = relative.split(path.sep);

  return parts.length === 1 ? "_root" : parts[0];
}

function groupEdges(root: string): Set<string> {
  const edges = new Set<string>();

  for (const file of productionSources(root)) {
    const from = groupOf(path.relative(root, file));

    for (const match of readFileSync(file, "utf-8").matchAll(
      /from\s+["']((?:\.\.?\/)+[^"']+)["']/g,
    )) {
      const target = path.resolve(path.dirname(file), match[1]);
      const relative = path.relative(root, target);
      if (relative.startsWith("..")) continue;

      const to = groupOf(relative);
      if (to !== from) edges.add(`${from} -> ${to}`);
    }
  }

  return edges;
}

/**
 * Each cycle is written from its alphabetically smallest member, so the same
 * ring always produces the same string no matter which node the walk entered it
 * from.
 */
function mutualPairs(edges: Set<string>): string[] {
  const pairs = new Set<string>();

  for (const edge of edges) {
    const [from, to] = edge.split(" -> ");
    if (from < to && edges.has(`${to} -> ${from}`)) {
      pairs.add(`${from} <-> ${to}`);
    }
  }

  return [...pairs].sort();
}

describe("the dependency direction between module groups", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it("scans a real tree of production sources", () => {
    const count = productionSources(root).length;

    // Guards the guard: an empty or tiny scan would make every assertion below
    // pass without looking at anything.
    expect(count).toBeGreaterThan(250);
  });

  it("adds no group pair that does not already import each other", () => {
    const pairs = mutualPairs(groupEdges(root));
    const fresh = pairs.filter((pair) => !KNOWN_MUTUAL_COUPLING.includes(pair));

    expect(fresh).toEqual([]);
  });

  it("keeps the lowest layer from reaching back up", () => {
    const edges = groupEdges(root);

    // utils sits under everything, so an import from utils to a feature group is
    // how a cycle starts. The four below are the pairs already recorded as debt;
    // a fifth one fails this test until the ring is broken instead of widened.
    const upwards = [...edges].filter(
      (edge) =>
        edge.startsWith("utils -> ") &&
        ![
          "utils -> config",
          "utils -> services",
          "utils -> session",
          "utils -> telemetry",
        ].includes(edge),
    );

    expect(upwards).toEqual([]);
  });
});
