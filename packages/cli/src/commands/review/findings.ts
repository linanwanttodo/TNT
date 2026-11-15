/**
 * Review findings the machine can order.
 *
 * A review agent's prose is fine for a human and useless for a report: nothing
 * could say which problem came first, and a reviewer that found three issues
 * printed them in whichever order it thought of them. The block below is the
 * contract; prose stays exactly as it was when the block is absent, so an agent
 * that never learned it costs nothing.
 */
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface Finding {
  severity: FindingSeverity;
  /** Path as the reviewer wrote it, repo relative. */
  file: string;
  line?: number;
  message: string;
}

export interface ParsedFindings {
  findings: Finding[];
  /** Lines inside the block that were not findings, kept so nothing is lost. */
  unread: string[];
}

const SEVERITY_RANK: FindingSeverity[] = ["critical", "high", "medium", "low"];

const FINDING_LINE =
  /^(critical|high|medium|low)\|([^\s|:]+)(?::(\d+))?\|(.+)$/;

/**
 * Sent to the reviewer as written, so it is static: the report is only useful
 * if the reader can rely on the shape, and a shape the agent invents per run is
 * not a shape.
 */
export const FINDINGS_CONTRACT = `Report what you found as one machine-readable block at the end of your answer, one finding per line:

<tnt-findings>
critical|src/payments.ts:123|what is wrong, and why it matters
</tnt-findings>

The severity is critical, high, medium or low; critical means data loss, a security hole, or a build that no longer runs. The path is relative to the repository and the line number is optional. Keep each finding on one line. Anything that is not a finding - context, a question, a note about what looked fine - stays in prose, which is printed as you wrote it.`;

export function parseFindings(output: string): ParsedFindings | undefined {
  const block = /<tnt-findings>([\s\S]*?)<\/tnt-findings>/.exec(output);
  if (!block) return undefined;

  const findings: Finding[] = [];
  const unread: string[] = [];

  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const parsed = FINDING_LINE.exec(line);
    if (!parsed) {
      unread.push(line);
      continue;
    }

    findings.push({
      severity: parsed[1] as FindingSeverity,
      file: parsed[2],
      ...(parsed[3] ? { line: Number(parsed[3]) } : {}),
      message: parsed[4].trim(),
    });
  }

  return { findings, unread };
}

/** Worst first, then file, then line, so two runs of the same diff agree. */
export function orderFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity =
      SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
    );
  });
}
