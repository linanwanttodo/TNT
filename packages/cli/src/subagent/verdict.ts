/**
 * The verdict an agent reports when its job was to check work rather than make
 * it. Reading it out of the prose turns a delegated verification into something
 * the caller can branch on, instead of a paragraph it has to re-read.
 */
export type SubAgentVerdict = "pass" | "fail" | "partial";

/**
 * A verdict line stands alone, on its own line, exactly one keyword after the
 * prefix. Matching inline would let a sentence like "there is no VERDICT: PASS
 * here" report a result, and the report's own quoted template would match on
 * the first line, so the last stand-alone line wins.
 */
const VERDICT_LINE = /^[ \t]*VERDICT:[ \t]*(PASS|FAIL|PARTIAL)[ \t]*$/gim;

export function parseVerdict(report: string): SubAgentVerdict | undefined {
  let verdict: SubAgentVerdict | undefined;
  for (const match of report.matchAll(VERDICT_LINE)) {
    verdict = match[1].toLowerCase() as SubAgentVerdict;
  }
  return verdict;
}
