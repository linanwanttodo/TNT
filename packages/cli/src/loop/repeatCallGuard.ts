/**
 * Advisory for a tool call that keeps repeating itself.
 *
 * A stuck model sometimes asks for the same tool with the same arguments over
 * and over even though the result cannot have changed. That is worth pointing
 * out, but it is not a termination condition: repeating a call is also what a
 * retry after an external change looks like, and a guard that stops the turn
 * would turn a harmless habit into a failed task. So this only produces text,
 * which rides inside the next tool result - the request tail, after the cached
 * prefix.
 *
 * Identity is the tool name plus a normalized argument document: keys are
 * sorted at every depth, so `{"a":1,"b":2}` and `{"b":2,"a":1}` describe one
 * call, and a changed argument value starts a new streak.
 */

export interface RepeatCallGuardOptions {
  /** Consecutive identical calls that earn a notice, in ascending order. */
  thresholds?: readonly number[];
}

const DEFAULT_THRESHOLDS = [3, 5, 8] as const;
/** One identity never earns more than this many notices. */
const MAX_NOTICES = 3;
/** How much of the arguments a notice quotes. */
const ARGUMENT_SUMMARY_LIMIT = 200;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/**
 * Canonical form of an argument document. A document that is not JSON is kept
 * as-is: the caller already decided it was worth passing, and dropping the
 * streak on a parse failure would hide the repeat it is meant to catch.
 */
export function normalizeRepeatCallArguments(argumentsJson: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(argumentsJson)));
  } catch {
    return argumentsJson.trim();
  }
}

function summarizeArguments(argumentsJson: string): string {
  const collapsed = argumentsJson.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > ARGUMENT_SUMMARY_LIMIT
    ? `${collapsed.slice(0, ARGUMENT_SUMMARY_LIMIT)}...`
    : collapsed;
}

export class RepeatCallGuard {
  private readonly thresholds: readonly number[];
  private identity: string | undefined;
  private count = 0;
  private notices = 0;

  constructor(options: RepeatCallGuardOptions = {}) {
    this.thresholds = [...(options.thresholds ?? DEFAULT_THRESHOLDS)].sort(
      (a, b) => a - b,
    );
  }

  /** Consecutive calls with the current identity. */
  get consecutiveCalls(): number {
    return this.count;
  }

  /**
   * Record one completed tool result and return the advice to append to it,
   * when this call's streak crosses one of the thresholds. Silent on every
   * other call, including the ones after the last notice: the guard keeps
   * counting, it just stops talking.
   */
  record(toolName: string, argumentsJson: string): string | undefined {
    const identity = `${toolName}\u001f${normalizeRepeatCallArguments(
      argumentsJson,
    )}`;
    if (identity === this.identity) {
      this.count += 1;
    } else {
      this.identity = identity;
      this.count = 1;
      this.notices = 0;
    }

    if (!this.thresholds.includes(this.count)) {
      return undefined;
    }
    if (this.notices >= MAX_NOTICES) {
      return undefined;
    }

    this.notices += 1;
    if (this.notices === 1) {
      return `You have called ${toolName} ${this.count} times in a row with identical arguments. Read the previous result before calling it again; if the arguments are not going to change, try a different approach.`;
    }
    return `${toolName} has now been called ${this.count} times in a row with identical arguments, so the result is unlikely to change. Change the arguments or the approach. Arguments: ${summarizeArguments(argumentsJson)}`;
  }

  /** Drop the streak. A new user turn starts from zero. */
  resetForNewTurn(): void {
    this.identity = undefined;
    this.count = 0;
    this.notices = 0;
  }
}
