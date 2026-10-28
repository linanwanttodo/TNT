/**
 * Scoring for the retrieval benchmark. A returned hit is a file plus, for the
 * two tools that speak in lines, the range it came from.
 *
 * The hit rule is deliberately the strict one: a returned chunk counts for a
 * label only when the same file was returned *and* the labelled line falls
 * inside the returned range. Reporting the file alone would let a tool that
 * names the right file and quotes the wrong lines score a hit, which is exactly
 * the failure a retrieval benchmark has to see.
 */

import { EvalQuery, Expectation, RECALL_AT, ToolName } from "./labels.js";

export interface RankedHit {
  /** Path relative to the corpus root, forward slashes. */
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface ResolvedExpectation extends Expectation {
  /** The line the marker was found on, resolved when the run started. */
  line: number;
}

export interface ExpectationOutcome {
  file: string;
  line: number;
  /** Zero-based position in the returned list, or `undefined` when absent. */
  rank?: number;
  /** The hit at that rank quotes a range the labelled line falls inside. */
  rangeCovered: boolean;
}

export interface QueryOutcome {
  id: string;
  track: EvalQuery["track"];
  tool: ToolName;
  /** Every expectation is satisfied (or one of them, for an `anyOf` query). */
  recalled: boolean;
  /** Rank of the first returned hit for any expectation, for the mean rank. */
  firstRank?: number;
  expectations: ExpectationOutcome[];
}

/** Does this returned hit quote the labelled line? */
export function hitCovers(hit: RankedHit, expectation: ResolvedExpectation) {
  if (hit.file !== expectation.file) {
    return false;
  }
  if (hit.startLine === undefined) {
    return true;
  }
  const last = hit.endLine ?? hit.startLine;
  return hit.startLine <= expectation.line && last >= expectation.line;
}

export function scoreQuery(
  query: EvalQuery,
  expectations: ResolvedExpectation[],
  hits: RankedHit[],
  recallAt = RECALL_AT,
): QueryOutcome {
  // The budget is in files, not in returned lines: `Search` answers with one
  // line per match and `CodebaseSearch` with one chunk, so counting raw hits
  // would give the two tools different-sized budgets and make a floor depend on
  // how densely one file happens to match. A file's own hits keep their order,
  // so the strict line rule is still tested against everything the tool said.
  const order: string[] = [];
  const byFile = new Map<string, RankedHit[]>();
  for (const hit of hits) {
    const seen = byFile.get(hit.file);
    if (seen) {
      seen.push(hit);
      continue;
    }
    byFile.set(hit.file, [hit]);
    order.push(hit.file);
  }
  const window = order.slice(0, recallAt);

  const outcomes = expectations.map<ExpectationOutcome>((expectation) => {
    const rank = window.indexOf(expectation.file);
    const covering = (byFile.get(expectation.file) ?? []).some((hit) =>
      hitCovers(hit, expectation),
    );
    return {
      file: expectation.file,
      line: expectation.line,
      rank: rank >= 0 ? rank : undefined,
      rangeCovered: rank >= 0 && covering,
    };
  });

  const landed = outcomes.filter((outcome) => outcome.rank !== undefined);
  const recalled = query.anyOf
    ? landed.length > 0
    : landed.length === outcomes.length;

  const ranks = landed.map((outcome) => outcome.rank as number);

  return {
    id: query.id,
    track: query.track,
    tool: query.tool,
    recalled,
    firstRank: ranks.length > 0 ? Math.min(...ranks) : undefined,
    expectations: outcomes,
  };
}

/** The bucket key both the report and the floor table use. */
export const bucketOf = (outcome: QueryOutcome) =>
  `${outcome.tool}/${outcome.track}`;

export interface BucketScore {
  queries: number;
  recallAt: number;
  mrr: number;
  /** Fraction of landed expectations that were quoted with a covering range. */
  lineCoverage: number;
}

export function scoreBuckets(
  outcomes: QueryOutcome[],
): Record<string, BucketScore> {
  const groups = new Map<string, QueryOutcome[]>();
  for (const outcome of outcomes) {
    const key = bucketOf(outcome);
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }

  const scores: Record<string, BucketScore> = {};
  for (const [key, group] of groups) {
    const reciprocal = group.map((outcome) =>
      outcome.firstRank === undefined ? 0 : 1 / (outcome.firstRank + 1),
    );
    const expected = group.reduce(
      (sum, outcome) => sum + outcome.expectations.length,
      0,
    );
    const covered = group.reduce(
      (sum, outcome) =>
        sum +
        outcome.expectations.filter((expectation) => expectation.rangeCovered)
          .length,
      0,
    );
    scores[key] = {
      queries: group.length,
      recallAt:
        group.filter((outcome) => outcome.recalled).length / group.length,
      mrr: reciprocal.reduce((sum, value) => sum + value, 0) / group.length,
      lineCoverage: expected === 0 ? 1 : covered / expected,
    };
  }
  return scores;
}
