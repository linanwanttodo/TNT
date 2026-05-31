import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The index database path is frozen when core/util/paths.js is first loaded
// (GLOBAL_DIR is a module-load constant), so the private home has to be in
// place before the first core import - against the user's real index, the
// global cache classifies a re-run's identical file contents as already
// indexed under another directory and no chunk is ever written for this
// workspace, which would mask the reconciliation under test.
process.env.TNT_GLOBAL_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "tnt-reconcile-home-"),
);

const { env } = await import("../config/env.js");
const { RetrievalService } = await import("./service.js");

/**
 * The index outlives the process that built it, but the workspace does not sit
 * still: an editor save, a git pull or a checkout all move files under an
 * index that still reports itself complete. These cases walk the
 * reconciliation that ensureIndexed now runs at stat level: an external
 * modification reaches search, an external deletion leaves it, and concurrent
 * callers share one background build.
 *
 * Every case works on its own workspace so one case's leftover catalog rows
 * cannot answer for another's.
 */
const CONFIG = `name: retrieval-reconcile-test
version: 0.0.1
models:
  - name: test-chat
    provider: openai
    model: gpt-4
    roles:
      - chat
    apiKey: test
context:
  - provider: codebase
`;

const workspaces: string[] = [];
let indexHome: string;

const hitNames = (hits: { filepath: string }[]): string[] =>
  hits.map((hit) => path.basename(fileURLToPath(hit.filepath)));

function freshWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-reconcile-"));
  workspaces.push(workspace);
  return workspace;
}

function externalWrite(file: string, content: string): void {
  // The edit goes around every TNT write path, like an editor would; the
  // write stamps the mtime the reconciliation compares against the catalog.
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), CONFIG);
});

afterAll(() => {
  indexHome = process.env.TNT_GLOBAL_DIR ?? indexHome;
  fs.rmSync(indexHome, { recursive: true, force: true });
  for (const workspace of workspaces) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("retrieval stale reconciliation", () => {
  it("picks up an external modification after the index was built", async () => {
    const workspace = freshWorkspace();
    const file = path.join(workspace, "changed.ts");
    fs.writeFileSync(file, "export const reconcileOldMarker = 1;\n");
    fs.writeFileSync(path.join(workspace, "README.md"), "# anchor\n");
    const service = new RetrievalService(workspace);
    await service.update();

    externalWrite(file, "export const reconcileFreshMarker = 42;\n");

    await service.ensureIndexed();
    // The reconciliation runs in the background; the search keeps answering
    // while it works, and lands on the new content once it has.
    const sawNewContent = await waitFor(async () => {
      const hits = await service.search("reconcileFreshMarker");
      return hitNames(hits).includes(path.basename(file));
    });
    expect(sawNewContent).toBe(true);
  }, 180_000);

  it("stops returning a file that was deleted outside the process", async () => {
    const workspace = freshWorkspace();
    const file = path.join(workspace, "removed.ts");
    fs.writeFileSync(file, "export const reconcileVanishingMarker = 7;\n");
    const service = new RetrievalService(workspace);
    await service.update();

    const before = await service.search("reconcileVanishingMarker");
    expect(hitNames(before)).toContain(path.basename(file));

    fs.rmSync(file);
    await service.ensureIndexed();

    const hitGone = await waitFor(async () => {
      const hits = await service.search("reconcileVanishingMarker");
      return !hitNames(hits).includes(path.basename(file));
    });
    expect(hitGone).toBe(true);
  }, 180_000);

  it("shares one background build between concurrent reconciling callers", async () => {
    const workspace = freshWorkspace();
    const file = path.join(workspace, "shared.ts");
    fs.writeFileSync(file, "export const reconcileSingleFlightMarker = 3;\n");
    const service = new RetrievalService(workspace);
    await service.update();

    const indexer = (service as any).indexer as {
      refreshCodebaseIndex: (dirs: string[]) => Promise<void>;
    };
    const builds: string[][] = [];
    const real = indexer.refreshCodebaseIndex.bind(indexer);
    indexer.refreshCodebaseIndex = async (dirs: string[]) => {
      builds.push(dirs);
      return real(dirs);
    };

    externalWrite(file, "export const reconcileSecondMarker = 4;\n");

    await Promise.all([
      service.ensureIndexed(),
      service.ensureIndexed(),
      service.ensureIndexed(),
    ]);
    // The reconciliation decides asynchronously; wait for the build to
    // surface before judging how many of them there were.
    await waitFor(async () => builds.length > 0);
    await waitFor(async () => !service.isIndexing());

    // One external change, one reconciliation decision, one build: the
    // single-flight pattern holds on the reconciliation path too.
    expect(builds).toHaveLength(1);
    expect(builds[0]).toEqual([expect.any(String)]);
  }, 180_000);
});
