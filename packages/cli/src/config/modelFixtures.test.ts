import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `models[].name` is required by the schema, and a fixture that omits it silently never parses:
 * the suites around it usually fail earlier (a prompt check) and their assertions still hold.
 * Two rounds were lost to that - `--model` probes died at `models.0: Invalid input`, and six
 * fixtures in the headless suites were found invalid only because of it.
 *
 * A list entry under `models:` may start with either key, so the scan keys on the entry and
 * asks whether it declares both `model:` and `name:`. The floor keeps a broken scan from
 * passing by finding nothing.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const ROOTS = ["e2e", "src", "test-utils"];

function testSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "__mocks__"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

function entryBlock(lines: string[], start: number): string[] {
  const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (/^\s*-\s/.test(line) && lineIndent <= indent) break;
    if (lineIndent <= indent && !/^\s*-\s/.test(line)) break;
    block.push(line);
  }
  return block;
}

function modelEntries(file: string): { offenders: string[]; total: number } {
  const offenders: string[] = [];
  let total = 0;
  const lines = fs.readFileSync(file, "utf-8").split("\n");

  lines.forEach((line, index) => {
    if (!/^\s*-\s+(?:name|model):\s*\S/.test(line)) return;
    const block = [line, ...entryBlock(lines, index)];
    if (!block.some((entry) => /^\s*(?:-\s+)?model:/.test(entry))) return;
    total++;
    if (!block.some((entry) => /^\s*(?:-\s+)?name:/.test(entry))) {
      offenders.push(`${path.relative(packageRoot, file)}:${index + 1}`);
    }
  });

  return { offenders, total };
}

describe("the model fixtures in the test suites", () => {
  it("give every model the name the schema requires", () => {
    const results = ROOTS.flatMap((root) =>
      testSources(path.join(packageRoot, root)).map(modelEntries),
    );
    const total = results.reduce((sum, result) => sum + result.total, 0);
    const offenders = results.flatMap((result) => result.offenders);

    expect(total).toBeGreaterThanOrEqual(8);
    expect(offenders).toEqual([]);
  });
});
