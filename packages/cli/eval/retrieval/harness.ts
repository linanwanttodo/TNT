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

/**
 * core looks for the grammar wasm files under `<cwd>/node_modules/tree-sitter-wasms/out`
 * when `NODE_ENV=test` (the bundled CLI carries its own copy next to the
 * bundle). Without them the indexer silently falls back to a line-based
 * chunker, and a benchmark would then be ranking chunks production never
 * produces. Link the workspace's own copy when it is missing, and say which of
 * the two the run actually measured.
 */
export function ensureGrammars(): GrammarState {
  const wanted = path.join(process.cwd(), "node_modules", "tree-sitter-wasms");
  if (fs.existsSync(wanted)) {
    return { chunker: "tree-sitter", note: "grammars already installed here" };
  }
  const source = path.resolve(
    process.cwd(),
    "..",
    "..",
    "core",
    "node_modules",
    "tree-sitter-wasms",
  );
  if (!fs.existsSync(path.join(source, "out"))) {
    return {
      chunker: "fallback",
      note: `no grammar directory at ${source}, so chunks are line-based`,
    };
  }
  fs.mkdirSync(path.dirname(wanted), { recursive: true });
  try {
    fs.symlinkSync(source, wanted, "dir");
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") {
      throw error;
    }
    // Another worker got here first; its link points at the same directory.
  }
  return { chunker: "tree-sitter", note: `linked from ${source}` };
}

export function stageCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-retrieval-eval-"));
  fs.cpSync(CORPUS, root, { recursive: true });
  corpusFiles(root).forEach((rel, index) => {
    const at = new Date(STAMPED + index * 1_000);
    const full = path.join(root, rel);
    fs.utimesSync(full, at, at);
  });
  return root;
}

export function writeConfig(semantic: boolean): void {
  fs.mkdirSync(env.continueHome, { recursive: true });
  fs.writeFileSync(
    path.join(env.continueHome, "config.yaml"),
    semantic ? SEMANTIC_CONFIG : LEXICAL_CONFIG,
    "utf-8",
  );
}

export interface BenchmarkRun {
  root: string;
  semantic: boolean;
  grammars: GrammarState;
  timings: { indexMs: number; queryMs: number };
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
  const grammars = ensureGrammars();
  const root = stageCorpus();
  writeConfig(semantic);

  const { resolved, problems } = resolveExpectations(root, QUERIES);

  const indexStart = Date.now();
  const retrieval = await openRetrieval(root);
  const indexMs = Date.now() - indexStart;

  const queryStart = Date.now();
  const outcomes: QueryOutcome[] = [];
  for (const query of QUERIES) {
    const expectations = resolved.get(query.id) ?? [];
    if (expectations.length === 0) {
      continue; // already reported as a label problem
    }
    const hits = await ask(query.tool, query.query, root, retrieval);
    outcomes.push(scoreQuery(query, expectations, hits));
  }

  return {
    root,
    semantic,
    grammars,
    timings: { indexMs, queryMs: Date.now() - queryStart },
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
        `  miss ${outcome.id}: ${JSON.stringify(outcome.expectations)}`,
    );

  return [
    `retrieval benchmark (${run.semantic ? "semantic" : "lexical"} track, ${run.grammars.chunker} chunker, index ${run.timings.indexMs}ms, queries ${run.timings.queryMs}ms)`,
    ...rows,
    ...(missed.length > 0 ? ["", "missed queries:", ...missed] : []),
    ...(run.labelProblems.length > 0
      ? ["", "label problems:", ...run.labelProblems]
      : []),
  ].join("\n");
}
