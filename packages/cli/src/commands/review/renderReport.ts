import chalk from "chalk";

import { orderFindings, parseFindings, type Finding } from "./findings.js";

export interface ReviewResult {
  /** Agent slug or local path */
  agent: string;
  /** Display name */
  name: string;
  /** "pass" if no changes suggested, "fail" if changes suggested, "error" if agent errored */
  status: "pass" | "fail" | "error";
  /** Unified diff patch of agent's suggested changes */
  patch: string;
  /** Agent's text output (explanation/rationale) */
  output: string;
  /** Duration in seconds */
  duration: number;
  /** Error message if status is "error" */
  error?: string;
}

export interface RenderOptions {
  baseBranch: string;
  changedFileCount: number;
  format: "text" | "json";
  checksFromHub: boolean;
}

/**
 * Render the review results report.
 */
export function renderReport(
  results: ReviewResult[],
  options: RenderOptions,
): string {
  if (options.format === "json") {
    return renderJsonReport(results, options);
  }
  return renderTextReport(results, options);
}

function renderJsonReport(
  results: ReviewResult[],
  _options: RenderOptions,
): string {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;

  return JSON.stringify(
    {
      reviews: results.map((r) => {
        const parsed = parseFindings(r.output);

        return {
          agent: r.agent,
          name: r.name,
          status: r.status,
          patch: r.patch,
          output: r.output,
          duration: r.duration,
          // Structured for whoever pipes this into a tool; the prose above is
          // untouched, so a consumer that reads the text still reads the same
          // thing it did before this field existed.
          ...(parsed && parsed.findings.length > 0
            ? { findings: orderFindings(parsed.findings) }
            : {}),
          ...(r.error ? { error: r.error } : {}),
        };
      }),
      summary: {
        total: results.length,
        passed,
        failed,
        errored,
      },
    },
    null,
    2,
  );
}

/** One finding per line, severity first: the reader should not hunt for the place. */
function findingLine(finding: Finding): string {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;

  return `${finding.severity}  ${where}  ${finding.message}`;
}

function renderTextReport(
  results: ReviewResult[],
  options: RenderOptions,
): string {
  const isTTY = process.stdout.isTTY;
  const lines: string[] = [];

  const failedResults = results.filter(
    (r) => r.status === "fail" || r.status === "error",
  );

  // Only output details for failures/errors — passes are already in the table
  for (const result of failedResults) {
    const durationStr = `(${result.duration.toFixed(1)}s)`;

    if (result.status === "error") {
      const header = isTTY
        ? chalk.red(`## ✗ ${result.name}`) + " " + chalk.dim(durationStr)
        : `## ✗ ${result.name} ${durationStr}`;
      lines.push(header);
      lines.push(`Error: ${result.error || "Unknown error"}`);
    } else {
      const header = isTTY
        ? chalk.red(`## ✗ ${result.name}`) + " " + chalk.dim(durationStr)
        : `## ✗ ${result.name} ${durationStr}`;
      lines.push(header);
      lines.push("");

      const parsed = parseFindings(result.output);
      const ordered = parsed ? orderFindings(parsed.findings) : [];

      if (ordered.length > 0) {
        lines.push("### Findings");
        for (const finding of ordered) {
          lines.push(`- ${findingLine(finding)}`);
        }
        lines.push("");
      }

      // The block itself is a wire format, not something to read: what it said
      // is in the list above, and a line the parser could not read is shown
      // rather than dropped.
      const prose = [
        parsed
          ? result.output
              .replace(/<tnt-findings>[\s\S]*?<\/tnt-findings>/, "")
              .trim()
          : result.output.trim(),
        (parsed?.unread ?? []).map((line) => `- ${line}`).join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n");

      if (prose) {
        lines.push(prose);
        lines.push("");
      }

      if (result.patch.trim()) {
        lines.push("### Suggested changes:");
        lines.push("```diff");
        lines.push(result.patch.trim());
        lines.push("```");
      }
    }

    lines.push("");
  }

  if (failedResults.length > 0) {
    lines.push("---");
    const summary = `**${failedResults.length} of ${results.length} reviews failed.**`;
    lines.push(isTTY ? chalk.red(summary) : summary);
    lines.push("");
  }

  // Migration nudge
  if (options.checksFromHub) {
    lines.push(
      isTTY
        ? chalk.dim("These reviews also run on your PRs via Continue CI.")
        : "These reviews also run on your PRs via Continue CI.",
    );
  } else {
    lines.push(
      isTTY
        ? chalk.dim(
            "Tip: Run these automatically on every PR → https://github.com/linanwanttodo/TNT",
          )
        : "Tip: Run these automatically on every PR → https://github.com/linanwanttodo/TNT",
    );
  }

  return lines.join("\n");
}
