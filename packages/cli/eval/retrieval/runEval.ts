/**
 * Entry point for reading the benchmark by hand:
 *
 *   npx tsx eval/retrieval/runEval.ts [--json]
 *
 * The global directory is pointed at a temp home before anything imports core,
 * because core resolves `CONTINUE_GLOBAL_DIR` into a constant at import time -
 * setting it later would leave the index database in a real user's directory.
 */

import fs from "fs";
import os from "os";
import path from "path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-retrieval-eval-home-"));
process.env.TNT_GLOBAL_DIR = home;
process.env.TNT_LOG_LEVEL ??= "warn";
// The benchmark runs as the guard test runs: core only looks for its grammar
// wasm files under `<cwd>/node_modules` in test mode, and the other branch
// resolves a `__dirname` that an ESM import graph does not have.
process.env.NODE_ENV = "test";

const { runBenchmark, formatReport } = await import("./harness.js");

const run = await runBenchmark();

if (process.argv.includes("--json")) {
  process.stdout.write(
    `${JSON.stringify({ scores: run.scores, outcomes: run.outcomes, labelProblems: run.labelProblems }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`${formatReport(run)}\n`);
}

fs.rmSync(run.dir, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });

// The report is written. core's indexer leaves a chunking worker pool behind -
// the CLI has its own shutdown path for it, which a bare script does not run -
// so the loop would otherwise stay open forever with nothing left to do.
process.exit(0);
