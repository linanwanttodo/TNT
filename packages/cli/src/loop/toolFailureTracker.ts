/**
 * Per-tool consecutive failure tally.
 *
 * A global "how many failures in a row" counter cannot tell a broken build
 * apart from a bad search string, because any failure resets the count. These
 * tallies are kept per tool name, and a success clears only that tool's count,
 * so "the tests keep failing" stays visible while a subsequent successful grep
 * does not mask it.
 */

export interface ToolFailureOptions {
  /**
   * Consecutive failures of the same tool before the loop is warned. Three
   * keeps a genuine fix-then-retry visible while stopping a tool that is
   * obviously not going to work.
   */
  threshold?: number;
}

export interface ToolFailureNotice {
  toolName: string;
  consecutiveFailures: number;
  /** Last error text observed for this tool, truncated for the notice. */
  lastError: string;
}

const DEFAULT_THRESHOLD = 3;
const ERROR_LIMIT = 400;

function summarize(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > ERROR_LIMIT
    ? `${collapsed.slice(0, ERROR_LIMIT)}...`
    : collapsed;
}

export class ToolFailureTracker {
  private readonly threshold: number;
  private readonly failures = new Map<string, number>();
  private readonly lastErrors = new Map<string, string>();
  /** Tools already reported, so a notice is emitted once per streak. */
  private readonly reported = new Set<string>();

  constructor(options: ToolFailureOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Record a tool call outcome and return a notice the first time this tool
   * reaches the threshold. A later success clears the streak so the same tool
   * can alert again after it recovers.
   */
  record(
    toolName: string,
    succeeded: boolean,
    error?: unknown,
  ): ToolFailureNotice | undefined {
    if (succeeded) {
      this.failures.delete(toolName);
      this.lastErrors.delete(toolName);
      this.reported.delete(toolName);
      return undefined;
    }

    this.lastErrors.set(toolName, summarize(error));

    const count = (this.failures.get(toolName) ?? 0) + 1;
    this.failures.set(toolName, count);

    if (count < this.threshold || this.reported.has(toolName)) {
      return undefined;
    }

    this.reported.add(toolName);
    return {
      toolName,
      consecutiveFailures: count,
      lastError: this.lastErrors.get(toolName) ?? "",
    };
  }

  /** Current consecutive failure count for a tool. */
  consecutiveFailures(toolName: string): number {
    return this.failures.get(toolName) ?? 0;
  }

  /** Tools that have failed at least once this turn. */
  failingTools(): string[] {
    return [...this.failures.keys()];
  }

  /** Drop all tallies. A new user turn starts from zero. */
  resetForNewTurn(): void {
    this.failures.clear();
    this.lastErrors.clear();
    this.reported.clear();
  }
}
