import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The other half of `usedKeysExist.test.ts`: that file refuses a call site
 * asking for a key the dictionaries do not carry, and nothing refused a key the
 * dictionaries carry that no caller ever asks for. Two such keys shipped this
 * week until they were counted, and a translation nobody reads is a small permanent
 * lie about what the UI says.
 *
 * A key can also be requested through a template - `t(\`profile.desc.${profile}\`)`
 * - which a literal scan cannot see. Those prefixes are listed below, and the last
 * case checks the list is still earning its place: if the dynamic builder goes
 * away, the exclusion has to go with it, or the day the exclusion is deleted it
 * would leave live text looking dead.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const DICTIONARY = path.join(here, "index.ts");
const SCAN_DIRS = ["src", "e2e", "test-utils"];

const DYNAMIC_KEY_PREFIXES: string[] = ["profile.desc."];

function sourceText(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist"].includes(entry.name)) {
          walk(full);
        }
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) {
        continue;
      }
      if (path.resolve(full) === DICTIONARY) {
        continue;
      }
      chunks.push(fs.readFileSync(full, "utf8"));
    }
  };
  for (const dir of SCAN_DIRS) {
    const root = path.join(packageRoot, dir);
    if (fs.existsSync(root)) {
      walk(root);
    }
  }
  return chunks.join("\n");
}

function dictionaryKeys(): string[] {
  const text = fs.readFileSync(DICTIONARY, "utf8");
  return [
    ...new Set(
      [...text.matchAll(/^  "([A-Za-z0-9.]+)":/gm)].map((match) => match[1]),
    ),
  ];
}

describe("the dictionary carries no key nobody asks for", () => {
  const keys = dictionaryKeys();
  const sources = sourceText();
  const dead = keys.filter(
    (key) =>
      !sources.includes(`"${key}"`) &&
      !DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );

  it("reads a dictionary and a source tree that are both really there", () => {
    expect(keys.length).toBeGreaterThan(300);
    expect(sources.length).toBeGreaterThan(200_000);
  });

  it("finds no key without a caller", () => {
    expect(dead).toEqual([]);
  });

  it("excludes only prefixes a dynamic builder still justifies", () => {
    for (const prefix of DYNAMIC_KEY_PREFIXES) {
      expect(
        sources.includes("t(`" + prefix),
        `no t(\`${prefix}\${...}) builder left, so drop the exclusion`,
      ).toBe(true);
      expect(
        keys.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });
});
