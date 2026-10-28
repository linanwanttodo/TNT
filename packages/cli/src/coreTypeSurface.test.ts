import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `core/index.d.ts` is the CLI's public view of the engine: bare `core` imports
 * resolve to it (`packages/cli/tsconfig.json` maps `core` into `core/dist`, and
 * no built `index.d.ts` exists there, so extension substitution lands on this
 * file). Nothing generates it - there is no `core/index.ts` - so it grows only
 * when someone types into it.
 *
 * That is the shape a ratchet is for: the numbers below are a decision, not a
 * measurement to keep up with. A round that needs another export adds one and
 * moves the number in the same commit, which is the one moment anyone looks at
 * how large this surface has become.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SURFACE = path.resolve(packageRoot, "..", "..", "core", "index.d.ts");

const source = fs.readFileSync(SURFACE, "utf-8");
const lines = source.split("\n");

/** Top-level declarations, by the keyword that introduces them. */
function declarations(kind: string): number {
  return lines.filter((line) => line.startsWith(`export ${kind} `)).length;
}

describe("the public type surface the CLI compiles against", () => {
  it("is the file the CLI actually resolves", () => {
    // A floor, because every count below would be zero on the wrong file - or
    // on an empty one - and zero reads as a clean pass.
    expect(lines.length).toBeGreaterThanOrEqual(2_000);
    expect(lines.length).toBeLessThanOrEqual(2_200);
  });

  it("keeps its declaration counts where the last round left them", () => {
    // Measured 2026-10-28: 128 interfaces, 51 type aliases, 3 classes, 2 enums.
    // The kinds are pinned separately so a rewrite that swaps an interface for a
    // class (or folds types into one) moves a number instead of passing silently.
    expect(declarations("interface")).toBe(128);
    expect(declarations("type")).toBe(51);
    expect(declarations("class")).toBe(3);
    expect(declarations("enum")).toBe(2);
  });
});
