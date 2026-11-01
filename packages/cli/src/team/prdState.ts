/**
 * The deterministic state table for PRD requirement entries
 * (agent-discipline.md 8.8). A status is derived from evidence, never from an
 * agent's own wording: the table runs top-down over the newest evidence for
 * one requirement and the first matching row wins.
 */

/**
 * One piece of closure evidence in the flow. `dispatch` is the main agent's
 * dispatch record; `implementer` is the implementer's own report (claiming
 * completion is not evidence); `tester` and `code-reviewer` are the checked
 * reports that do count; `verification` is a verdict line transcribed from
 * the verifier's report.
 */
export interface PrdEvidence {
  requirement: string;
  kind:
    "dispatch" | "implementer" | "tester" | "code-reviewer" | "verification";
  verdict?: "PASS" | "FAIL" | "PARTIAL";
}

export interface PrdStateRow {
  status: string;
  /** True when this row's condition matches the evidence for a requirement. */
  matches: (evidence: PrdEvidence[]) => boolean;
}

const forRequirement = (evidence: PrdEvidence[], requirement: string) =>
  evidence.filter((entry) => entry.requirement === requirement);

const lastIndexOfKind = (entries: PrdEvidence[], kind: PrdEvidence["kind"]) => {
  let index = -1;
  entries.forEach((entry, i) => {
    if (entry.kind === kind) index = i;
  });
  return index;
};

export const STATE_TABLE: PrdStateRow[] = [
  {
    status: "未通过",
    matches: (entries) => {
      const lastVerification = lastIndexOfKind(entries, "verification");
      if (lastVerification < 0) return false;
      const verdict = entries[lastVerification]?.verdict;
      if (verdict !== "FAIL" && verdict !== "PARTIAL") return false;
      // Work resumed after the verdict (a new dispatch, a tester pass): the
      // loop-back rule moves the entry on instead of leaving it stuck.
      const resumed = entries.some(
        (entry, i) =>
          i > lastVerification &&
          (entry.kind === "dispatch" ||
            entry.kind === "tester" ||
            entry.kind === "code-reviewer"),
      );
      return !resumed;
    },
  },
  {
    status: "已验收",
    matches: (entries) =>
      lastIndexOfKind(entries, "verification") >= 0 &&
      entries[lastIndexOfKind(entries, "verification")]?.verdict === "PASS",
  },
  {
    status: "已实现",
    matches: (entries) =>
      entries.some(
        (entry) => entry.kind === "tester" || entry.kind === "code-reviewer",
      ),
  },
  {
    status: "开发中",
    matches: (entries) => entries.some((entry) => entry.kind === "dispatch"),
  },
  {
    status: "待开发",
    matches: () => true,
  },
];

function lastIndexPass(entries: PrdEvidence[]): number {
  let index = -1;
  entries.forEach((entry, i) => {
    if (entry.kind === "verification" && entry.verdict === "PASS") index = i;
  });
  return index;
}

export function prdStatusOf(
  requirement: string,
  evidence: PrdEvidence[],
): string {
  const entries = forRequirement(evidence, requirement);
  for (const row of STATE_TABLE) {
    if (row.matches(entries)) {
      return row.status;
    }
  }
  return "待开发";
}

/**
 * Transitions that may not be written directly. 已验收 -> 待开发 must go
 * through a PRD change record first; 未通过 -> 开发中 is legal only because
 * a new dispatch record exists in the evidence (row 4 outranks row 5).
 */
export const ILLEGAL_TRANSITIONS = [
  { from: "已验收", to: "待开发", bypass: "变更记录" },
] as const;
