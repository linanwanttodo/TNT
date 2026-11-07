/**
 * The six-state closure vocabulary of the goal-development flow
 * (agent-discipline.md 8.6). Every in-flow report opens with one status word;
 * downstream consumers read the word, never the prose.
 *
 * SPEC-ONLY for now: the vocabulary is executable and tested, but nothing in
 * the running agent calls it yet - the flow's report reader has not been
 * built, and PRD state is not persisted anywhere. A consumer added here must
 * be deliberate: this module decides how a report closes, so wiring it in
 * changes what a team run reports, not just how it is formatted.
 */

export const CLOSURE_STATUSES = [
  "progress",
  "waiting",
  "ready",
  "blocked",
  "failed",
  "dropped",
] as const;

export type ClosureStatus = (typeof CLOSURE_STATUSES)[number];

/** The word and its Chinese rendering, both legal in a report's first line. */
const STATUS_WORDS: Readonly<Record<ClosureStatus, string[]>> = {
  progress: ["progress", "进展"],
  waiting: ["waiting", "等待"],
  ready: ["ready", "就绪"],
  blocked: ["blocked", "受阻"],
  failed: ["failed", "失败"],
  dropped: ["dropped", "无需处理"],
};

/**
 * The status a report closes with, read from its first line only. A status
 * word buried in the body does not close anything; a report without one has
 * not closed at all and reads as undefined to its consumer.
 */
export function closureStatusOf(report: string): ClosureStatus | undefined {
  const firstLine = report.trimStart().split("\n", 1)[0] ?? "";
  for (const status of CLOSURE_STATUSES) {
    const words = STATUS_WORDS[status];
    if (
      words.some(
        (word) => firstLine.startsWith(word) || firstLine.includes(word),
      )
    ) {
      return status;
    }
  }
  return undefined;
}

/**
 * A dropped verdict closes silently - the user is not interrupted - so the
 * PRD change record is its only trace. Every other status may surface to the
 * user in its own right and leaves no mandatory record.
 */
export function requiresChangeRecord(status: ClosureStatus): boolean {
  return status === "dropped";
}
