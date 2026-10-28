import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatReport, runBenchmark } from "./harness.js";
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
 * The build is the slow part, so it happens once for the whole file.
 */
let run: BenchmarkRun;

beforeAll(async () => {
  run = await runBenchmark();
}, 420_000);

afterAll(() => {
  fs.rmSync(run.root, { recursive: true, force: true });
});

describe("retrieval benchmark", () => {
  it("labels a line that still exists in the corpus", () => {
    expect(run.labelProblems).toEqual([]);
  });

  it("scores every tool and track the query set claims to cover", () => {
    const wanted = [
      ...new Set(QUERIES.map((query) => `${query.tool}/${query.track}`)),
    ].sort();

    expect(Object.keys(run.scores).sort()).toEqual(wanted);
  });

  it("recalls at least as well as the last measured run", () => {
    const failures: string[] = [];

    for (const [bucket, score] of Object.entries(run.scores)) {
      const floor = FLOORS[bucket];
      if (!floor) {
        failures.push(
          `${bucket}: no floor recorded - measured recall@8 ${score.recallAt.toFixed(
            3,
          )}, mrr ${score.mrr.toFixed(3)}`,
        );
        continue;
      }
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

  it("is answered well enough to be believed", () => {
    // A bucket floor can stay green while the whole run collapses into a few
    // easy tracks; this is the coarse check that the corpus as a whole is being
    // read, not just the part of it a change happens to still hit.
    const answered = run.outcomes.filter((outcome) => outcome.recalled);

    expect(answered.length / run.outcomes.length).toBeGreaterThanOrEqual(0.6);
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
