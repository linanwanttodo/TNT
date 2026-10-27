import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, test } from "vitest";

/**
 * `core`'s published build once shipped its own test suite: `tsconfig.npm.json`
 * included everything and excluded only `test` and `dist`, so 173 test and
 * scaffolding files landed in `dist`. The fix lives in the build inputs, which
 * means nothing keeps it there: a lane that changes its naming pattern, or an
 * exclude list edited during a refactor, would put the suites back into the
 * package with every gate green.
 *
 * So the coupling is run: every pattern the lane collects has to appear in the
 * published build's exclude list, and the scaffolding directory has to stay out
 * too. One lane is left here, but the list stays a list: a second runner added
 * later only has to be named below to be covered.
 */
const coreRoot = path.dirname(fileURLToPath(import.meta.url));

function configText(file: string): string {
  return fs.readFileSync(path.join(coreRoot, file), "utf-8");
}

function quotedStringsIn(text: string, blockStart: string): string[] {
  const start = text.indexOf(blockStart);
  if (start < 0) return [];
  const end = text.indexOf("]", start);
  if (end < 0) return [];
  return [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("the published build keeps the test suites out", () => {
  const lanePatterns = quotedStringsIn(
    configText("vitest.config.ts"),
    "include: [",
  );
  const excluded = quotedStringsIn(
    configText("tsconfig.npm.json"),
    `"exclude": [`,
  );

  it("reads the lane pattern and an exclude list", () => {
    // A guard whose inputs came back empty would agree with any build config.
    expect(lanePatterns.length).toBe(1);
    expect(excluded.length).toBeGreaterThanOrEqual(5);
  });

  it("excludes every pattern the lane collects", () => {
    for (const pattern of lanePatterns) {
      expect(excluded, pattern).toContain(pattern);
    }
  });

  it("keeps the scaffolding and the output directory out", () => {
    expect(excluded).toContain("**/__mocks__");
    expect(excluded).toContain("dist");
  });
});
