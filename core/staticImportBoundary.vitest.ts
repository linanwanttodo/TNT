import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The CLI reaches core through `core/config/ConfigHandler.ts`. Whatever those
 * config modules import at runtime decides what ships in a user's installation.
 * Ten runtime imports across two files put 306 core source files in the bundle -
 * every context provider the CLI never calls, every legacy tool definition, 66
 * provider classes and the vendored transformers runtime.
 *
 * `import type` is free: TypeScript erases it and esbuild never sees it. So the
 * rule is not "do not refer to these registries" but "do not load them".
 *
 * What leaks is the *barrel*, not the directory: `core/tools/index.ts` does
 * `import * as toolDefinitions from "./definitions"` and pulls the whole tree
 * in, while `core/tools/applyToolOverrides.ts` imports only a type module and
 * a package and is a leaf. So the tools barrel is matched exactly and every
 * module under `llm`, `context/mcp` and `context/providers` is matched as a
 * subtree, because all of those are part of a registry. Getting this wrong in
 * either direction makes the guard lie.
 *
 * Specifiers are resolved to real paths before matching, not compared as
 * strings. `../../tools` and `../tools` are the same module seen from
 * different depths, and a string comparison is depth-sensitive: it reports a
 * clean boundary while the edge is still there.
 */
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const TOOL_BARREL = [
  path.resolve(ROOT, "tools"),
  path.resolve(ROOT, "tools", "index"),
];

const REGISTRY_SUBTREES = [
  path.resolve(ROOT, "llm"),
  path.resolve(ROOT, "context", "mcp"),
  path.resolve(ROOT, "context", "providers"),
];

/**
 * A registry reaching into itself is the registry's own business, not the
 * config layer loading it. Only an importer that lives outside a subtree is
 * measured against it.
 */
const isRegistry = (specifier: string, importer: string) => {
  const resolved = path.resolve(path.dirname(importer), specifier);
  const insideTree = REGISTRY_SUBTREES.some((tree) =>
    importer.startsWith(`${tree}${path.sep}`),
  );

  return (
    TOOL_BARREL.includes(resolved) ||
    (!insideTree &&
      REGISTRY_SUBTREES.some(
        (tree) =>
          resolved === tree || resolved.startsWith(`${tree}${path.sep}`),
      ))
  );
};

/**
 * Runtime registry imports still loaded eagerly. Every entry is a defect with a
 * follow-up recorded in `docs/superpowers/plans/2026-10-27-HANDOFF-startup-chunk.md`
 * §7, not an allowance: adding one fails the guard, and so does a scan that
 * silently reads nothing, because the list would no longer match. Cleared as
 * each one is lazified.
 */
const ALLOWED_RUNTIME_IMPORTS: string[] = [
  "config/profile/doLoadConfig.ts <- ../../context/mcp/MCPManagerSingleton",
  "config/profile/doLoadConfig.ts <- ../../context/providers/MCPContextProvider",
  "config/profile/doLoadConfig.ts <- ../../tools",
  "config/yaml/loadYaml.ts <- ../../context/mcp/MCPManagerSingleton",
  "config/yaml/loadYaml.ts <- ../../context/mcp/json/loadJsonMcpConfigs",
  "config/yaml/loadYaml.ts <- ../../llm/llms/TransformersJsEmbeddingsProvider",
  "config/yaml/loadYaml.ts <- ../../tools",
  "config/yaml/models.ts <- ../../llm",
  "config/yaml/models.ts <- ../../llm/llms",
];

const CONSUMERS = [
  "config/load.ts",
  "config/loadContextProviders.ts",
  "config/yaml/loadYaml.ts",
  "config/yaml/models.ts",
  "config/profile/doLoadConfig.ts",
  "llm/index.ts",
];

type ImportStatement = { bindings: string; specifier: string };

/**
 * Every top-level `import ... from "<module>"` in `text`. Statements span
 * multiple lines, so a line scan cannot tell a runtime import from a type-only
 * one: `import {\n  type A,\n} from "../llm"` is free but opens and closes on
 * different lines. Only whole statements are returned, which is also what makes
 * the scan ignore a dynamic `await import(...)` inside a function body.
 */
function importStatements(text: string): ImportStatement[] {
  const lines = text.split("\n");
  const statements: ImportStatement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].trim();

    if (!opening.startsWith("import ")) continue;
    // A dynamic `import(...)` or a generic type argument, not a statement.
    if (/^import\s*[(<]/.test(opening)) continue;
    if (opening.startsWith("import type ")) continue;

    // The `from` clause can sit several lines down.
    let last = i;
    while (
      last < lines.length &&
      !/from\s+"[^"]+"/.test(lines.slice(i, last + 1).join(" "))
    ) {
      last++;
    }

    const statement = lines
      .slice(i, last + 1)
      .join(" ")
      .match(/^import\s+(.*?)\s+from\s+"([^"]+)"/s);
    if (!statement) continue;

    i = last;
    statements.push({
      bindings: statement[1],
      specifier: statement[2],
    });
  }

  return statements;
}

/** True when every named binding is type-only, so the statement loads nothing. */
function isTypeOnly(bindings: string): boolean {
  const trimmed = bindings.trim();

  if (trimmed.startsWith("type ") || trimmed === "") return true;
  if (!trimmed.startsWith("{")) return false;

  const names = trimmed
    .slice(1, trimmed.lastIndexOf("}"))
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

function runtimeRegistryImports(file: string, text: string): string[] {
  const hits: string[] = [];

  for (const { bindings, specifier } of importStatements(text)) {
    if (!isRegistry(specifier, file)) continue;
    if (isTypeOnly(bindings)) continue;

    hits.push(`${path.relative(ROOT, file)} <- ${specifier}`);
  }

  return hits.sort();
}

describe("the registry imports core loads on behalf of the CLI", () => {
  it("reads files that still hold the imports this guard is about", () => {
    const lazilyLoaded = ["config/load.ts", "config/loadContextProviders.ts"];

    // Floor: a rename or an emptied file would otherwise make the scan report
    // no registry at all, which is the same green as a clean boundary. Both are
    // clean by design now, so what proves they are still being read is the
    // dynamic form that replaced the static one.
    for (const relative of lazilyLoaded) {
      const text = readFileSync(path.join(ROOT, relative), "utf8");

      expect(text).toMatch(/import\("\.\.\/context\/providers/);
    }
  });

  it("loads no provider, tool or context registry beyond the frozen list", () => {
    const measured = CONSUMERS.flatMap((relative) => {
      const file = path.join(ROOT, relative);

      return runtimeRegistryImports(file, readFileSync(file, "utf8"));
    }).sort();

    expect(measured).toEqual(ALLOWED_RUNTIME_IMPORTS);
  });
});
