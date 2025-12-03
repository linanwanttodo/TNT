import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `core` runs two lanes with naming-based collection: vitest takes
 * `**\/*.vitest.ts` and jest takes `**\/*.test.ts`. A third naming - a `.spec.ts`,
 * or a `.test.tsx` - matches neither, so it would sit in the tree, never run, and
 * still look like a suite. That exact gap was found once by a hand audit
 * (168 files on disk, all collected); this file makes the property standing.
 *
 * The patterns are read from the two configs rather than restated, so changing a
 * lane's include reddens this guard instead of silently orphaning files.
 */
const coreRoot = path.dirname(fileURLToPath(import.meta.url));

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function testishFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      testishFiles(full, found);
    } else if (/\.(?:test|vitest|spec)\.[cm]?tsx?$/.test(entry.name)) {
      found.push(path.relative(coreRoot, full));
    }
  }
  return found;
}

function laneIncludes(configFile: string, expected: string): boolean {
  return fs
    .readFileSync(path.join(coreRoot, configFile), "utf-8")
    .includes(expected);
}

describe("every core test file is collected by at least one lane", () => {
  const files = testishFiles(coreRoot);

  it("still finds the two lane patterns where it reads them", () => {
    expect(laneIncludes("vitest.config.ts", '"**/*.vitest.ts"')).toBe(true);
    expect(laneIncludes("jest.config.js", '"**/*.test.ts"')).toBe(true);
  });

  it("collects a tree big enough for the check to mean something", () => {
    // Floors per lane so a broken walk cannot agree with everything.
    const vitestFiles = files.filter((f) => f.endsWith(".vitest.ts"));
    const jestFiles = files.filter((f) => f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(150);
    expect(vitestFiles.length).toBeGreaterThan(80);
    expect(jestFiles.length).toBeGreaterThan(40);
  });

  it("leaves no test-named file outside both lanes", () => {
    // A `.tsx`, `.mts` or `.spec` suite matches neither include, and nothing in
    // either runner would report that it exists.
    expect(
      files.filter(
        (file) => !file.endsWith(".vitest.ts") && !file.endsWith(".test.ts"),
      ),
    ).toEqual([]);
  });
});
