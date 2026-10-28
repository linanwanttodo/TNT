import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * What the shipped bundle evaluates before it can answer a prompt.
 *
 * The CLI starts at `dist/tnt.js`, which awaits one dynamic import of the entry
 * chunk; everything that chunk reaches through *static* imports is parsed and
 * run on every start, whether or not the session ever needs it. Two rounds of
 * laziness work (the provider registries, the retrieval service) bought that,
 * and a single new top-level `import` in a startup file gives it back without
 * any test noticing - which is why the `DocsService` static embeddings field was
 * left alone: measured here, the embeddings provider is not in this graph at all.
 *
 * The graph is read from the built bundle rather than from source, because the
 * bundler is what decides it: a source file can be imported statically by
 * something else and still land behind a chunk boundary.
 */
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);
const LAUNCHER = "tnt.js";

/** Static edges only: `from "./x.js"` and a bare `import "./x.js"`. */
function staticImports(file: string): string[] {
  const source = readChunk(file);
  const found = new Set<string>();
  for (const match of source.matchAll(/from\s*"(\.\/[^"]+\.js)"/g)) {
    found.add(match[1].slice(2));
  }
  for (const match of source.matchAll(/^import\s*"(\.\/[^"]+\.js)"/gm)) {
    found.add(match[1].slice(2));
  }
  return [...found];
}

function readChunk(file: string): string {
  try {
    return fs.readFileSync(path.join(dist, file), "utf-8");
  } catch {
    return "";
  }
}

/** The entry chunk the launcher awaits, then everything it statically pulls in. */
function eagerGraph(): string[] {
  const launcher = readChunk(LAUNCHER);
  const roots = [...launcher.matchAll(/import\(\s*"\.\/([^"]+\.js)"/g)].map(
    (match) => match[1] as string,
  );
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const chunk = stack.pop() as string;
    if (seen.has(chunk)) {
      continue;
    }
    seen.add(chunk);
    stack.push(...staticImports(chunk));
  }
  return [...seen];
}

function bytesOf(chunks: string[]): number {
  return chunks.reduce(
    (total, chunk) =>
      total +
      (fs.existsSync(path.join(dist, chunk))
        ? fs.statSync(path.join(dist, chunk)).size
        : 0),
    0,
  );
}

describe("the bundle's eager startup graph", () => {
  // The graph is a property of the build, and `dist` is what the CLI loads. A
  // checkout that has not been built says so instead of measuring nothing.
  const built = fs.existsSync(path.join(dist, LAUNCHER));
  const chunks = built ? eagerGraph() : [];
  const bytes = built ? bytesOf(chunks) : 0;

  it("is measured against a built bundle", (ctx) => {
    if (!built) {
      ctx.skip();
    }
    // An unbuilt checkout reports itself as skipped, which is visible; this is
    // the case that catches a walk that found *nothing* - a renamed entry chunk
    // or a launcher that no longer awaits it would otherwise make the two
    // ceilings below pass by measuring an empty set.
    expect(chunks).toContain("index.js");
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    expect(bytes).toBeGreaterThanOrEqual(500_000);
  });

  it("stays inside the measured budget of chunks and bytes", (ctx) => {
    if (!built) {
      ctx.skip();
    }
    // Measured 2026-10-28 at `ff98d6535`: 14 chunks, 854,159 bytes (834 KB).
    // The headroom is for a dependency bump, not for a new startup import: the
    // retrieval service chunk alone is 77,733 bytes, and the embeddings provider
    // chunk drags thirty-six more chunks in behind it.
    expect(chunks.length).toBeLessThanOrEqual(16);
    expect(bytes).toBeLessThanOrEqual(950_000);
  });

  it("keeps the heavy modules behind a dynamic import", (ctx) => {
    if (!built) {
      ctx.skip();
    }
    // Chunk *names* are the bundler's business and move with it, so this looks
    // for what only those modules say: an embeddings model id, the vector-store
    // package, the grammar directory the chunker reads, the docs index class.
    // Each string exists in this build (checked before it was trusted); if one
    // turns up in a chunk the launcher reaches statically, that module is parsed
    // on every start, whether or not the session has a codebase provider.
    const markers = [
      "all-MiniLM-L6-v2",
      "lancedb",
      "tree-sitter-wasms",
      "DocsService",
    ];
    for (const chunk of chunks) {
      const source = readChunk(chunk);
      for (const marker of markers) {
        expect(
          source.includes(marker),
          `${marker} is evaluated on every start (found in ${chunk}); it belongs behind an import()`,
        ).toBe(false);
      }
    }
  });
});
