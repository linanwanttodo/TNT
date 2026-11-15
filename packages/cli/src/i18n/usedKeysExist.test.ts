import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * A mistyped translation key is invisible at compile time: `t` accepts a string
 * and the call sites cast, so the failure reaches the user as the raw key
 * printed where a sentence should be. Every key written as a literal in the
 * sources is looked up here in the English dictionary, which the type system
 * already forces the Chinese one to match (`zhCN` is declared as
 * `Record<TranslationKey, string>`, so a missing or extra key there is a build
 * error and this file does not have to re-check it).
 *
 * Only literals are covered. A key assembled at runtime - from a variable or a
 * template - cannot be resolved by reading the source, and the count assertion
 * below exists so a broken scan cannot pass by finding nothing.
 */
function dictionaryKeys(): Set<string> {
  const source = fs.readFileSync(
    path.join(packageRoot, "src/i18n/index.ts"),
    "utf-8",
  );
  const start = source.indexOf("const en = {");
  const open = source.indexOf("{", start);
  let depth = 0;
  let close = open;
  while (close < source.length) {
    if (source[close] === "{") {
      depth += 1;
    } else if (source[close] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    close += 1;
  }

  return new Set(
    [...source.matchAll(/^\s{2}"([A-Za-z0-9._-]+)":/gm)].map((m) => m[1]),
  );
}

function literalKeyUses(): Map<string, string> {
  const uses = new Map<string, string>();

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__mocks__") walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !entry.name.includes(".test.") &&
        full !== path.join(packageRoot, "src/i18n/index.ts")
      ) {
        const source = fs.readFileSync(full, "utf-8");
        for (const match of source.matchAll(
          /(?<![\w.])t\(\s*"([A-Za-z0-9._-]+)"/g,
        )) {
          uses.set(
            match[1] as string,
            path.relative(packageRoot, full).split(path.sep).join("/"),
          );
        }
      }
    }
  };
  walk(path.join(packageRoot, "src"));

  return uses;
}

describe("the translation keys the sources ask for", () => {
  it("scans enough literal keys for the result to mean something", () => {
    expect(literalKeyUses().size).toBeGreaterThan(200);
  });

  it("never asks for a key the dictionary does not define", () => {
    const defined = dictionaryKeys();

    const unknown = [...literalKeyUses()]
      .filter(([key]) => !defined.has(key))
      .map(([key, where]) => `${key} used in ${where}`);

    expect(unknown).toEqual([]);
  });

  it("finds the dictionary it is checking against", () => {
    expect(dictionaryKeys().size).toBeGreaterThan(300);
  });
});
