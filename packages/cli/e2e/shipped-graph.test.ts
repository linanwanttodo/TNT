import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { describe, expect, it } from "vitest";

type ChunkOutput = {
  inputs: Record<string, { bytesInOutput: number }>;
  imports?: { path?: string; kind?: string }[];
};

const BUILD_META = path.resolve("build-meta.json");
const BUILD_TIMEOUT_MS = 600_000;

/**
 * `core/config/load.ts` reaching the provider, tool and context registries put
 * every one of them in what the CLI has to fetch, and the first pass at this
 * measured the wrong thing: it counted source files in `dist` (which never
 * moves under `splitting: true`) and then called the largest chunk the startup
 * chunk, when the largest chunk is in fact the retrieval service's, reached only
 * by a dynamic import. So this asserts on the graph instead of on sizes, and it
 * anchors the config path by the module that defines it rather than by whoever
 * happens to be biggest.
 *
 * `dist/` and `build-meta.json` are build products and both are gitignored, so
 * this belongs with the e2e suites, which run after a build - and it builds
 * rather than skipping when the file is missing, so it cannot go green by
 * measuring nothing.
 */
function readMetafile(): Record<string, ChunkOutput> {
  if (!fs.existsSync(BUILD_META)) {
    execFileSync("npm", ["run", "build"], {
      cwd: path.dirname(BUILD_META),
      stdio: "ignore",
      timeout: BUILD_TIMEOUT_MS,
    });
  }

  const metafile = JSON.parse(fs.readFileSync(BUILD_META, "utf8"));

  return metafile.outputs as Record<string, ChunkOutput>;
}

/**
 * Everything the entry has to evaluate before it can hand over control: only
 * `import-statement` edges, because a `dynamic-import` edge is fetched when
 * something reaches for it, not when the chunk loads.
 */
function eagerClosure(
  outputs: Record<string, ChunkOutput>,
  entry: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const chunk = queue.pop()!;
    if (seen.has(chunk)) continue;
    seen.add(chunk);

    for (const imported of outputs[chunk].imports ?? []) {
      if (imported.kind !== "import-statement") continue;
      if (!imported.path || !outputs[imported.path]) continue;
      queue.push(imported.path);
    }
  }

  return seen;
}

function sourcePathsOf(
  outputs: Record<string, ChunkOutput>,
  chunks: Set<string>,
): string[] {
  return [...chunks].flatMap((chunk) => Object.keys(outputs[chunk].inputs));
}

function bytesOf(
  outputs: Record<string, ChunkOutput>,
  chunks: Set<string>,
): number {
  return [...chunks].reduce(
    (total, chunk) =>
      total +
      Object.values(outputs[chunk].inputs).reduce(
        (sum, input) => sum + input.bytesInOutput,
        0,
      ),
    0,
  );
}

/** The chunk that carries a given source file, asserting there is exactly one. */
function chunkHolding(
  outputs: Record<string, ChunkOutput>,
  sourceSuffix: string,
): string {
  const found = Object.keys(outputs)
    .filter((chunk) => chunk.endsWith(".js"))
    .filter((chunk) =>
      Object.keys(outputs[chunk].inputs).some((source) =>
        source.endsWith(sourceSuffix),
      ),
    );

  expect(found, `which chunk holds ${sourceSuffix}`).toHaveLength(1);

  return found[0];
}

describe("E2E: what the shipped CLI has to evaluate", () => {
  const outputs = readMetafile();

  // The bin is a wrapper that awaits this one, so its eager closure is what a
  // process pays before it does anything else.
  const startup = eagerClosure(outputs, "dist/index.js");
  // Retrieval is what reaches `ConfigHandler`, and so what reaches the config
  // layer: the path the registries used to be dragged along by.
  const configPath = eagerClosure(
    outputs,
    chunkHolding(outputs, "src/retrieval/service.ts"),
  );

  const startupSources = sourcePathsOf(outputs, startup);
  const configSources = sourcePathsOf(outputs, configPath);

  it("measures real graphs, not an empty lookup", () => {
    // Both guards below would pass on an empty set, which is what a renamed
    // entry or a missing anchor quietly produces.
    expect(startupSources.length).toBeGreaterThan(100);
    expect(configSources.length).toBeGreaterThan(100);
  });

  it("starts a process without loading any registry or browser runtime", () => {
    for (const [name, pattern] of [
      [
        "the provider, tool and context registries",
        /\/core\/(llm|tools|context)\//,
      ],
      ["puppeteer", /puppeteer/],
      ["the vendored transformers runtime", /\/core\/vendor\//],
    ] as const) {
      expect(
        startupSources.filter((source) => pattern.test(source)),
        `startup should not evaluate ${name}`,
      ).toEqual([]);
    }

    // A ceiling rather than an exact figure: a dependency bump legitimately
    // moves the byte count, while anything eager-loaded belongs in the
    // categorical assertions above.
    expect(bytesOf(outputs, startup)).toBeLessThan(1_000_000);
  });

  it("reaches the config layer without the registries or puppeteer behind it", () => {
    for (const [name, pattern] of [
      ["the context provider barrel", /\/core\/context\/providers\/index/],
      ["the legacy tool barrel", /\/core\/tools\/index/],
      ["the llm provider registry", /\/core\/llm\/llms\//],
      ["puppeteer and its chromium resolver", /puppeteer/],
      ["the vendored transformers runtime", /\/core\/vendor\//],
    ] as const) {
      expect(
        configSources.filter((source) => pattern.test(source)),
        `the config path should not statically reach ${name}`,
      ).toEqual([]);
    }
  });
});
