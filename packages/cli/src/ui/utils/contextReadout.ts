/**
 * The context and usage readout, computed the way pi computes it.
 *
 * The context number is the provider's own measurement of the last request
 * (prompt tokens), not a local re-count of the history: a local count is
 * neither measured nor cheap, and it is the number that decides when the
 * session compacts. When the last request is unknown - before the first
 * answer, or after a compaction that has not been followed by a reply - the
 * readout says so instead of showing a number it cannot stand behind.
 */

/** Token counts as the compact readout writes them: 1234, 12.3k, 1.2M. */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export interface ContextUsage {
  /** Tokens the provider measured for the last request. */
  tokens: number | null;
  /** The model's context window. */
  contextWindow: number;
  /** Share of the window in use, or null when it is unknown. */
  percent: number | null;
}

/**
 * The context share, from the measured prompt tokens and the model's window.
 * A window of zero means the model does not declare one, so there is no
 * percentage to report.
 */
export function contextUsage(
  measuredPromptTokens: number | undefined,
  contextWindow: number,
): ContextUsage {
  if (contextWindow <= 0) {
    return { tokens: null, contextWindow: 0, percent: null };
  }
  if (!measuredPromptTokens || measuredPromptTokens <= 0) {
    return { tokens: null, contextWindow, percent: null };
  }
  return {
    tokens: measuredPromptTokens,
    contextWindow,
    percent: (measuredPromptTokens / contextWindow) * 100,
  };
}

/** The compact readout: `42.1%/200k`, or `?/200k` when it is unknown. */
export function formatContextUsage(usage: ContextUsage): string {
  const window = formatTokens(usage.contextWindow);
  if (usage.percent === null || usage.tokens === null) {
    return `?/${window}`;
  }
  return `${usage.percent.toFixed(1)}%/${window}`;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export function emptyUsageTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/**
 * The footer readout: the cache hit rate of the last round and the measured
 * context share. Those are the two numbers a reader watches; the session's
 * token arrows and its cost are reported by `/cost` on demand, so the footer
 * does not spend width on them every frame.
 */
export function formatStatusReadout(input: {
  rate: number | undefined;
  context: string;
  /** The localized label in front of the cache rate. */
  cacheLabel: string;
}): string {
  const parts: string[] = [];
  if (input.rate !== undefined && input.rate > 0) {
    parts.push(`${input.cacheLabel} ${(input.rate * 100).toFixed(1)}%`);
  }
  if (input.context) parts.push(input.context);
  return parts.join(" ");
}

/**
 * The per-turn readout, in pi's order: what was read, what was written, what
 * the cache saved, what the cache stored, the hit rate, and the cost.
 */
export function formatTurnUsage(
  totals: UsageTotals,
  latestPromptTokens: number,
): string[] {
  const parts: string[] = [];
  if (totals.input > 0) parts.push(`↑${formatTokens(totals.input)}`);
  if (totals.output > 0) parts.push(`↓${formatTokens(totals.output)}`);
  if (totals.cacheRead > 0) parts.push(`R${formatTokens(totals.cacheRead)}`);
  if (totals.cacheWrite > 0) parts.push(`W${formatTokens(totals.cacheWrite)}`);
  if (totals.cacheRead > 0 && latestPromptTokens > 0) {
    const rate = (totals.cacheRead / latestPromptTokens) * 100;
    parts.push(`CH${rate.toFixed(1)}%`);
  }
  if (totals.cost > 0) {
    parts.push(`$${totals.cost.toFixed(3)}`);
  }
  return parts;
}
