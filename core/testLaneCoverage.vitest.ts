import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, test } from "vitest";

/**
 * `core` collected its suites with two naming-based lanes: vitest took
 * `**\/*.vitest.ts` and jest took `**\/*.test.ts`. A third naming - a `.spec.ts`,
 * or a `.test.tsx` - matched neither, so it would sit in the tree, never run, and
 * still look like a suite. That exact gap was found once by a hand audit
 * (168 files on disk, all collected); this file makes the property standing.
 *
 * The two lanes have since been collapsed into one, so there is now a single
 * naming to keep: everything is a `*.vitest.ts`, and a `.test.ts` left behind
 * would be collected by nothing at all. The pattern is read from the config
 * rather than restated, so changing the include reddens this guard instead of
 * silently orphaning files.
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

function laneInclude(): string | undefined {
  const config = fs.readFileSync(
    path.join(coreRoot, "vitest.config.ts"),
    "utf-8",
  );
  return /include:\s*\[([^\]]*)\]/.exec(config)?.[1].replace(/["\s]/g, "");
}

describe("every core test file is collected by the lane", () => {
  const files = testishFiles(coreRoot);

  it("still finds the lane pattern where it reads it", () => {
    expect(laneInclude()).toBe("**/*.vitest.ts");
  });

  it("collects a tree big enough for the check to mean something", () => {
    // A floor so a broken walk cannot agree with everything.
    const vitestFiles = files.filter((f) => f.endsWith(".vitest.ts"));
    expect(files.length).toBeGreaterThan(150);
    expect(vitestFiles.length).toBeGreaterThan(150);
  });

  it("leaves no test-named file outside the lane", () => {
    // A `.test.ts` predates the single runner and nothing collects it now; a
    // `.tsx` or `.spec` suite matches no include either way.
    expect(files.filter((file) => !file.endsWith(".vitest.ts"))).toEqual([]);
  });
});
