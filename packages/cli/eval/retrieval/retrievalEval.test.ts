import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveExpectations } from "./adapters.js";
import { CORPUS, formatReport, runBenchmark } from "./harness.js";
import type { BenchmarkRun } from "./harness.js";
import { FLOORS, QUERIES } from "./labels.js";

/**
 * The quality guard for the three ways the CLI finds code.
 *
 * Unit tests can only ask whether a tool returned *something*; this asks
 * whether it returned the right thing, on a corpus whose answers are pinned. It
 * runs in the ordinary suite, so a retrieval change - a different chunker, a
 * merge order, a reranker that is now consulted - has to move a number here
 * before it can reach `main`.
 *
 * The scoring half only means something against the chunker production uses, so
 * a run that could not reach the tree-sitter grammars skips it rather than
 * measuring a different thing against these floors. The half that checks the
 * labels, the floor table and this document runs everywhere.
 */
describe("retrieval benchmark setup", () => {
  it("labels a line that still exists in the corpus", () => {
    const { problems } = resolveExpectations(CORPUS, QUERIES);

    expect(problems.map((problem) => problem.why)).toEqual([]);
  });

  it("floors every bucket the query set covers, and no others", () => {
    const covered = [
      ...new Set(QUERIES.map((query) => `${query.tool}/${query.track}`)),
    ].sort();

    expect(Object.keys(FLOORS).sort()).toEqual(covered);
  });

  it("documents the floors it enforces", () => {
    // The table in EVAL.md is what a reader trusts; this is what runs. A row
    // that drifts from `FLOORS` would teach the next person the wrong number.
    const doc = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "EVAL.md"),
      "utf-8",
    );

    const documented = new Map<string, string>();
    for (const row of doc.matchAll(
      /^\|\s*([A-Za-z]+\/[a-z-]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/gm,
    )) {
      documented.set(row[1] as string, `${row[2]}|${row[3]}`);
    }

    const missing = Object.keys(FLOORS).filter(
      (bucket) => !documented.has(bucket),
    );
    const wrong = Object.entries(FLOORS)
      .filter(
        ([bucket, floor]) =>
          documented.get(bucket) !== `${floor.recallAt}|${floor.mrr}`,
      )
      .map(
        ([bucket, floor]) =>
          `${bucket}: EVAL.md says ${documented.get(bucket)}, the guard enforces ${floor.recallAt}/${floor.mrr}`,
      );

    expect(missing).toEqual([]);
    expect(wrong).toEqual([]);
    expect(documented.size).toBe(Object.keys(FLOORS).length);
  });
});

describe("retrieval benchmark", () => {
  let run: BenchmarkRun;

  beforeAll(async () => {
    run = await runBenchmark();
  }, 420_000);

  afterAll(async () => {
    // The run sat inside its own working directory to reach the grammars, and on
    // Windows the copied wasm files are still open by the parser when the last
    // query returns: the first `rmdir` answers `ENOTEMPTY` for the parent, which
    // `force` does not cover. The sibling temp-directory cleanups retry for the
    // same reason - but `maxRetries` belongs to `rmSync`, which applies it to
    // every entry it visits, and twenty-seven grammar files at 40 × 250 ms made
    // this hook cost 200 seconds on the runner (12 seconds in the run before
    // it), long enough to starve the render polls in the lanes sharing the
    // machine and past the hook's own 30 second timeout. So the budget lives
    // here, around the whole attempt: one delete, then a bounded wait between
    // tries, with the hook timeout outside it rather than discovered by a red
    // lane.
    //
    // A directory the operating system still refuses is named on the console
    // rather than thrown. The scored assertions above have already been
    // recorded, whichever way they went, and the next run is handed a fresh
    // directory - so a leftover costs a temp entry and nothing else, while
    // failing the suite would hide the very numbers this run exists to report.
    const deadline = Date.now() + 6_000;
    let failure: Error | undefined;
    for (;;) {
      try {
        fs.rmSync(run.dir, { recursive: true, force: true });
        return;
      } catch (error) {
        failure = error as Error;
      }
      if (Date.now() >= deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    console.warn(
      `retrieval benchmark left ${run.dir} behind: ${failure?.message}`,
    );
  }, 20_000);

  /** Only the tree-sitter chunks are what a shipped CLI ranks with. */
  function requireRealChunks(ctx: { skip: () => void }): void {
    if (run.grammars.chunker !== "tree-sitter") {
      ctx.skip();
    }
  }

  it("recalls at least as well as the last measured run", (ctx) => {
    requireRealChunks(ctx);

    const failures: string[] = [];
    for (const [bucket, score] of Object.entries(run.scores)) {
      const floor = FLOORS[bucket];
      if (score.recallAt < floor.recallAt) {
        failures.push(
          `${bucket}: recall@8 ${score.recallAt.toFixed(3)} below the ${floor.recallAt} floor`,
        );
      }
      if (score.mrr < floor.mrr) {
        failures.push(
          `${bucket}: mrr ${score.mrr.toFixed(3)} below the ${floor.mrr} floor`,
        );
      }
    }

    expect(failures, formatReport(run)).toEqual([]);
  });

  it("is answered well enough to be believed", (ctx) => {
    requireRealChunks(ctx);

    // A bucket floor can stay green while the whole run collapses into a few
    // easy tracks; this is the coarse check that the corpus as a whole is being
    // read, not just the part of it a change happens to still hit.
    const answered = run.outcomes.filter((outcome) => outcome.recalled);

    expect(answered.length / run.outcomes.length).toBeGreaterThanOrEqual(0.6);
  });
});
