import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The CLI reaches core through `core/config/ConfigHandler.ts`. Whatever that
 * file imports at runtime is what ships in a user's installation. Ten runtime
 * imports across two files put 306 core source files in the bundle - every
 * context provider the CLI never calls, every legacy tool definition, 66
 * provider classes and the vendored transformers runtime.
 *
 * `import type` is free: TypeScript erases it and esbuild never sees it. So the
 * rule is not "do not refer to these registries" but "do not load them".
 *
 * What leaks is the *barrel*, not the directory: `core/tools/index.ts` does
 * `import * as toolDefinitions from "./definitions"` and pulls the whole tree
 * in, while `core/tools/applyToolOverrides.ts` imports only a type module and
 * a package and is a leaf. So `../tools` is matched exactly and `../llm` is
 * matched by prefix, because every `../llm/llms*` module is part of the
 * registry. Getting this wrong in either direction makes the guard lie.
 */
const BARREL_MODULES = ["../tools"];
const REGISTRY_SUBTREES = ["../llm", "../context/mcp", "../context/providers"];

const isRegistry = (specifier: string) =>
  BARREL_MODULES.includes(specifier) ||
  REGISTRY_SUBTREES.some(
    (registry) =>
      specifier === registry || specifier.startsWith(`${registry}/`),
  );

/** Loaded at runtime today. Every entry is a defect, not an allowance. */
const ALLOWED_RUNTIME_IMPORTS: string[] = [];

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every top-level `import ... from "<registry>"` in `text` that is not a
 * type-only import. Only top-level statement lines are considered, which is what
 * makes the check survive a dynamic `await import(...)` inside a function body:
 * that form carries no leading `import` keyword.
 */
function runtimeRegistryImports(text: string): string[] {
  const hits: string[] = [];
  let inTypeBlock = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("import type ")) continue;

    // A multi-line `import {\n  type A,\n  type B,\n} from "..."` marks the
    // whole statement as type-only on its opening line.
    if (trimmed.startsWith("import {")) {
      inTypeBlock = trimmed.includes("type {");
    }

    const specifier = trimmed.match(/from\s+"([^"]+)"/)?.[1];
    if (!specifier) continue;
    if (!isRegistry(specifier)) continue;
    if (inTypeBlock) continue;

    hits.push(`${specifier} <- ${trimmed}`);
  }

  return hits.sort();
}

describe("the registry imports core loads on behalf of the CLI", () => {
  const consumers = ["config/load.ts", "llm/index.ts"];

  it("reads files that still contain the imports this guard is about", () => {
    const text = readFileSync(path.join(ROOT, "config/load.ts"), "utf8");

    // Floor: a rename would otherwise make the scan report zero offenders,
    // which is the same green as a clean boundary.
    expect(text.length).toBeGreaterThan(5_000);
    expect(text).toContain("intermediateToFinalConfig");
  });

  it("loads no provider, tool or context registry at runtime", () => {
    const measured = consumers.flatMap((relative) =>
      runtimeRegistryImports(readFileSync(path.join(ROOT, relative), "utf8")),
    );

    expect(measured).toEqual(ALLOWED_RUNTIME_IMPORTS);
  });
});
