/**
 * The benchmark run itself: stage the corpus, build the index over it, ask each
 * tool the labeled questions, and score what comes back.
 *
 * Nothing here needs a model or a key. The full-text index is what
 * `CodebaseSearch` answers from when no embeddings model is configured, so the
 * scored tracks are the ones a runner can reproduce on any machine. The
 * semantic track runs only when `TNT_EVAL_EMBEDDINGS=1` and an embeddings
 * model is reachable, and says so in the report rather than passing quietly.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "../../src/config/env.js";

import {
  corpusFiles,
  fromGlobOutput,
  fromRetrievalHits,
  fromSearchOutput,
  resolveExpectations,
} from "./adapters.js";
import { QUERIES, RECALL_AT } from "./labels.js";
import {
  BucketScore,
  QueryOutcome,
  RankedHit,
  scoreBuckets,
  scoreQuery,
} from "./metrics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS = path.join(here, "corpus");

/**
 * A config with a codebase context provider and no embeddings model: the
 * indexer still chunks the workspace and fills the full-text table, which is
 * the half this benchmark scores.
 */
const LEXICAL_CONFIG = `name: retrieval-eval
version: 0.0.1
models:
  - name: eval-chat
    provider: openai
    model: gpt-4o-mini
    roles:
      - chat
    apiKey: not-used-by-the-index
context:
  - provider: codebase
`;

const SEMANTIC_CONFIG = `${LEXICAL_CONFIG}
  - provider: codebase
    embeddingModel:
      provider: transformers.js
      model: all-MiniLM-L6-v2
`;

/** An absolute timestamp per file: `Glob` ranks by modified time, and the run must not drift. */
const STAMPED = 1_700_000_000_000;

export interface GrammarState {
  /** `tree-sitter` when the chunker really parsed the corpus, `fallback` otherwise. */
  chunker: "tree-sitter" | "fallback";
  note: string;
}

/** `packages/cli`, so the grammar search does not depend on where the run sits. */
const packageRoot = path.resolve(here, "..", "..");

/**
 * core looks for the grammar wasm files under `<cwd>/node_modules/tree-sitter-wasms/out`
 * when `NODE_ENV=test`; the bundled CLI carries its own copy next to the bundle.
 * Without them the indexer silently falls back to line-based chunks, and the
 * benchmark would rank chunks production never produces.
 *
 * The link is made inside the run's own working directory rather than the
 * repository's `node_modules`: creating it there changes how *every other suite*
 * chunks its fixtures, which is a side effect a benchmark does not get to have.
 */
function ensureGrammars(workDir: string): GrammarState {
  const source = path.join(
    packageRoot,
    "..",
    "..",
    "core",
    "node_modules",
    "tree-sitter-wasms",
  );
  if (process.env.TNT_EVAL_GRAMMARS === "0") {
    return {
      chunker: "fallback",
      note: "grammar lookup was turned off for this run",
    };
  }
  if (!fs.existsSync(path.join(source, "out"))) {
    return {
      chunker: "fallback",
      note: `no grammar directory at ${source}, so chunks are line-based`,
    };
  }
  const wanted = path.join(workDir, "node_modules", "tree-sitter-wasms");
  fs.mkdirSync(path.dirname(wanted), { recursive: true });

  const linkError = tryGrammarLink(source, wanted);
  if (!linkError) {
    return { chunker: "tree-sitter", note: `linked from ${source}` };
  }

  // An ordinary user cannot always make a directory link - Windows allows it
  // only in developer mode - so fall back to copying the handful of grammars the
  // corpus resolves to. That is a few megabytes, and it keeps the run on the
  // chunker production uses instead of a line-based one.
  const copied = copyNeededGrammars(source, wanted);
  if (copied.length > 0) {
    return {
      chunker: "tree-sitter",
      note: `copied ${copied.join(", ")} from ${source} (${linkError})`,
    };
  }
  return {
    chunker: "fallback",
    note: `no grammar reached ${wanted}: ${linkError}`,
  };
}

/** Returns `undefined` when the link exists, otherwise why it does not. */
function tryGrammarLink(source: string, wanted: string): string | undefined {
  // `copy` exercises the copy branch on a machine that would happily take the
  // link, so the fallback is not a path only a foreign CI gets to run.
  if (process.env.TNT_EVAL_GRAMMARS === "copy") {
    return "the environment asked for a copy";
  }
  try {
    fs.symlinkSync(source, wanted, "dir");
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** The grammar a corpus extension resolves to, in core's own naming. */
const GRAMMAR_FOR_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
};

function copyNeededGrammars(source: string, wanted: string): string[] {
  const languages = [
    ...new Set(
      corpusFiles(CORPUS)
        .map((rel) => GRAMMAR_FOR_EXTENSION[path.extname(rel).toLowerCase()])
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const out = path.join(wanted, "out");
  fs.mkdirSync(out, { recursive: true });
  const copied: string[] = [];
  for (const language of languages) {
    const file = `tree-sitter-${language}.wasm`;
    const from = path.join(source, "out", file);
    if (!fs.existsSync(from)) {
      continue;
    }
    fs.copyFileSync(from, path.join(out, file));
    copied.push(language);
  }
  return copied;
}

export interface StagedRun {
  /** Everything the run created - removing this is the whole cleanup. */
  dir: string;
  /** The staged copy of the corpus, which is what the tools were pointed at. */
  root: string;
  /** A directory whose `node_modules` carries the grammars for this run only. */
  workDir: string;
}

function stageCorpus(): StagedRun {
  // Resolved at the one boundary where the run creates the tree, so the
  // directory the tools are pointed at and the directory the index reports are
  // the same spelling from the start.
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tnt-retrieval-eval-")),
  );
  const root = path.join(base, "corpus");
  const workDir = path.join(base, "work");
  fs.cpSync(CORPUS, root, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  corpusFiles(root).forEach((rel, index) => {
    const at = new Date(STAMPED + index * 1_000);
    const full = path.join(root, rel);
    fs.utimesSync(full, at, at);
  });
  return { dir: base, root, workDir };
}

function writeConfig(semantic: boolean): void {
  fs.mkdirSync(env.continueHome, { recursive: true });
  fs.writeFileSync(
    path.join(env.continueHome, "config.yaml"),
    semantic ? SEMANTIC_CONFIG : LEXICAL_CONFIG,
    "utf-8",
  );
}

export interface BenchmarkRun extends StagedRun {
  semantic: boolean;
  grammars: GrammarState;
  timings: { indexMs: number; queryMs: number };
  /**
   * Whether the full-text index answered at all, measured apart from the scored
   * queries: a bucket of zeros means either an empty index or a path mapping
   * that names no label, and this says which.
   */
  indexProbe: {
    hasIndex: boolean;
    controlHits: number;
    controlSample: string[];
  };
  outcomes: QueryOutcome[];
  scores: Record<string, BucketScore>;
  /** Labels that no longer resolve to one line - the corpus has drifted. */
  labelProblems: string[];
}

/** Ask one tool, in the shape its own model-visible answer has. */
async function ask(
  tool: string,
  query: string,
  root: string,
  retrieval: Awaited<ReturnType<typeof openRetrieval>>,
): Promise<RankedHit[]> {
  if (tool === "CodebaseSearch") {
    return fromRetrievalHits(root, await retrieval.search(query, RECALL_AT));
  }
  if (tool === "Search") {
    const { searchCodeTool } = await import("../../src/tools/searchCode.js");
    const output = await searchCodeTool.run!(
      { pattern: query, path: root, head_limit: 200 },
      {} as never,
    );
    return fromSearchOutput(root, String(output));
  }
  const { globFilesTool } = await import("../../src/tools/globFiles.js");
  const output = await globFilesTool.run!(
    { pattern: query, path: root },
    {} as never,
  );
  return fromGlobOutput(root, String(output));
}

async function openRetrieval(root: string) {
  const { getRetrievalService } =
    await import("../../src/retrieval/service.js");
  const service = getRetrievalService(root);
  await service.ensureIndexed();
  return service;
}

export async function runBenchmark(): Promise<BenchmarkRun> {
  const semantic = process.env.TNT_EVAL_EMBEDDINGS === "1";
  const staged = stageCorpus();
  const grammars = ensureGrammars(staged.workDir);
  writeConfig(semantic);

  const { resolved, problems } = resolveExpectations(staged.root, QUERIES);
  const outcomes: QueryOutcome[] = [];

  // The grammar lookup is relative to the working directory, so the run sits in
  // its own for the duration and comes back before anything else is asked.
  const previousCwd = process.cwd();
  process.chdir(staged.workDir);
  const indexStart = Date.now();
  let indexMs = 0;
  let queryMs = 0;
  let indexProbe: BenchmarkRun["indexProbe"] = {
    hasIndex: false,
    controlHits: 0,
    controlSample: [],
  };
  try {
    const retrieval = await openRetrieval(staged.root);
    indexMs = Date.now() - indexStart;

    // `TtlCache` is named in three corpus files, so any index that was built at
    // all answers this. The sample is what separates an empty index from a
    // workspace whose paths came back spelled differently from the labels - the
    // two look identical in a bucket of zeros.
    const control = fromRetrievalHits(
      staged.root,
      await retrieval.search("TtlCache", RECALL_AT),
    );
    indexProbe = {
      hasIndex: await retrieval.hasIndex(),
      controlHits: control.length,
      controlSample: control.slice(0, 3).map((hit) => hit.file),
    };

    const queryStart = Date.now();
    for (const query of QUERIES) {
      const expectations = resolved.get(query.id) ?? [];
      if (expectations.length === 0) {
        continue; // already reported as a label problem
      }
      const hits = await ask(query.tool, query.query, staged.root, retrieval);
      outcomes.push(scoreQuery(query, expectations, hits));
    }
    queryMs = Date.now() - queryStart;
  } finally {
    process.chdir(previousCwd);
  }

  return {
    ...staged,
    semantic,
    grammars,
    timings: { indexMs, queryMs },
    indexProbe,
    outcomes,
    scores: scoreBuckets(outcomes),
    labelProblems: problems.map((problem) => problem.why),
  };
}

export function formatReport(run: BenchmarkRun): string {
  const rows = Object.entries(run.scores)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([bucket, score]) =>
        `${bucket.padEnd(28)} queries=${String(score.queries).padStart(2)}  ` +
        `recall@${RECALL_AT}=${score.recallAt.toFixed(3)}  ` +
        `mrr=${score.mrr.toFixed(3)}  ` +
        `lines=${score.lineCoverage.toFixed(3)}`,
    );
  const missed = run.outcomes
    .filter((outcome) => !outcome.recalled)
    .map(
      (outcome) =>
        `  miss ${outcome.id}: ${JSON.stringify(outcome.expectations)}\n` +
        `    answered ${outcome.returnedFiles} file(s): ${outcome.sample.join(" | ") || "(nothing)"}`,
    );

  return [
    `retrieval benchmark (${run.semantic ? "semantic" : "lexical"} track, ${run.grammars.chunker} chunker, index ${run.timings.indexMs}ms, queries ${run.timings.queryMs}ms)`,
    `index probe: hasIndex=${String(run.indexProbe.hasIndex)} control hits=${run.indexProbe.controlHits} [${run.indexProbe.controlSample.join(" | ")}]`,
    ...rows,
    ...(missed.length > 0 ? ["", "missed queries:", ...missed] : []),
    ...(run.labelProblems.length > 0
      ? ["", "label problems:", ...run.labelProblems]
      : []),
  ].join("\n");
}
