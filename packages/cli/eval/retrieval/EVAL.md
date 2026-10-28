# Retrieval benchmark

`packages/cli/eval/retrieval`

Unit tests around the retrieval tools can only ask whether an answer came back.
This asks whether the answer was the one that is there: a fixed corpus with
labelled questions, scored per tool and per kind of question, with a floor that
a change has to clear. It runs inside the ordinary suite (`npx vitest run
eval/retrieval`), so a chunker swap, a merge-order edit, or a reranker that is
now consulted shows up as a number before it shows up as a user complaint.

## What is measured

Three ways the CLI finds code, each with the budget a model actually gets:

| Tool             | What it is asked                       |
| ---------------- | -------------------------------------- |
| `CodebaseSearch` | text over the workspace's index        |
| `Search`         | an exact pattern or regular expression |
| `Glob`           | a path pattern                         |

A query is answered by a ranked list. The budget is **8 distinct files** - not
8 returned lines, because `Search` answers one line per match and
`CodebaseSearch` one chunk, and counting hits would quietly give the two tools
different budgets and let a floor depend on how densely a file matches.

- **recall@8** - the labelled file is inside the first eight files returned.
- **mrr** - reciprocal of the position of the first labelled file.
- **line coverage** - a returned chunk quotes the labelled line rather than only
  naming its file. Reported, not floored: `Glob` returns files, so the rule has
  no meaning there, and a floor on a mixture would hide more than it shows.

## Tracks

Each track exists so a tool is not scored on the same thing twice:

| Track          | Question style                                                  |
| -------------- | --------------------------------------------------------------- |
| `symbol`       | an identifier that exists in the code                           |
| `phrase`       | wording that only lives in a comment or a document              |
| `near-miss`    | tokens that also appear in a distractor file, so order decides  |
| `cross-file`   | a definition and its caller, both of which belong in the answer |
| `file-pattern` | which files exist under a path glob                             |

## Ground truth

`corpus/` is a twelve-file service written for this purpose: an order flow, a
billing side with a retry policy, a cache with a test file that names the same
symbols, and two documents that describe them. The distractors are deliberate -
the cache's test file reuses its vocabulary, and the documents restate the code.

A label is a `(file, marker)` pair, never a line number. The marker is a phrase
inside the labelled line, and the harness resolves it when the run starts, so
editing a fixture moves its own label. A marker that matches zero lines or two
lines in its file is reported by the guard rather than scored - a benchmark
whose ground truth has quietly rotted is worse than none.

Multi-line markers do not work: resolution reads line by line. Keep a marker
inside one line of the fixture.

## Which chunker ran

core looks for its tree-sitter grammars under `<cwd>/node_modules/tree-sitter-wasms/out`
when `NODE_ENV=test`, and next to its own compiled output otherwise. Under a
plain ESM import the second branch resolves a `__dirname` that does not exist,
and the indexer falls back to line-based chunks - which would have the benchmark
rank chunks production never produces.

So the run works from a directory of its own, `…/work`, whose `node_modules`
holds a link to the workspace's copy of the grammars. It deliberately does not
create that link in the repository's `node_modules`: a link there changes how
every _other_ suite chunks its fixtures, and a benchmark does not get to decide
that. The report line names what actually ran:

```
retrieval benchmark (lexical track, tree-sitter chunker, index 2289ms, queries 549ms)
```

Where the link cannot be made - a platform that needs a privilege for it, or an
install without the grammars - the two scoring cases skip themselves instead of
measuring line-based chunks against floors from tree-sitter ones; the label and
documentation cases still run. `TNT_EVAL_GRAMMARS=0` forces that path, which is
how the skip is checked on a machine where linking would succeed.

The semantic track (`TNT_EVAL_EMBEDDINGS=1`) needs a reachable embeddings model
and is not part of the CI floor. Nothing else here sends a request: the scored
tracks run on the full-text index, which needs no provider.

## Reading the floors

| Bucket                    | recall@8 | mrr  |
| ------------------------- | -------- | ---- |
| CodebaseSearch/symbol     | 0.8      | 0.5  |
| CodebaseSearch/phrase     | 0.6      | 0.5  |
| CodebaseSearch/near-miss  | 0.6      | 0.5  |
| CodebaseSearch/cross-file | 0.75     | 0.6  |
| Search/symbol             | 1        | 0.5  |
| Search/phrase             | 1        | 0.3  |
| Search/near-miss          | 1        | 0.5  |
| Search/cross-file         | 1        | 0.3  |
| Glob/file-pattern         | 1        | 0.75 |

`Search`'s recall is decided by the pattern, so it is floored at 1: a file that
holds the text has to appear. Its order comes from the directory walk, which is
not portable, so its mrr floors are loose. A bucket missing from this table
fails the guard, which is what stops a dropped track from passing by absence.

To move a floor: re-run, take the new measurement, and set the floor under it.
Never raise a floor to match a change you have not measured, and never lower one
to make a red bucket green without saying in the commit what was lost.

## Known misses at the measured baseline

Two `CodebaseSearch` queries miss on the full-text index alone, both in tracks
where a document says the same thing as the code:

- `cb-one-load-per-key` - the phrasing is shared with `docs/architecture.md` and
  neither file reaches the top eight for that query.
- `cb-ttl-window` - a keyword-style query ("ttl expiry older than window") that
  the substring matcher has no way to rank; `Search` finds it when given the
  identifier.

They stay in the set as the reason the floors are under 1 rather than at it.

## Files

- `corpus/` - the fixture project, twelve files
- `labels.ts` - queries, expectations, the recall budget, and `FLOORS`
- `adapters.ts` - tool output to ranked hits, and label resolution
- `metrics.ts` - the scoring rules
- `harness.ts` - stage the corpus, build the index, run the queries
- `runEval.ts` - read it by hand: `npx tsx eval/retrieval/runEval.ts [--json]`
- `retrievalEval.test.ts` - the guard the suite runs
