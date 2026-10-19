const SEPARATOR = " · ";

export interface UsageLineLabels {
  ctx: string;
  cache?: string;
  out?: string;
  cost?: string;
}

export interface UsageLineInput {
  usedTokens?: number;
  limitTokens?: number;
  contextPercentage?: number;
  cacheHitRatio?: number;
  outputTokens?: number;
  cost?: number;
  /** Replaces the whole cost group, for a caller that says more than an amount. */
  costGroup?: string;
  labels: UsageLineLabels;
}

/**
 * `18200` is `18.2k` and `200000` is `200k`: one decimal while it saves a
 * character, none once rounding up would cost one.
 */
export function compactTokenCount(count: number): string {
  if (count < 1000) {
    return `${count}`;
  }
  const thousands = count / 1000;
  const text =
    thousands >= 100
      ? `${Math.round(thousands)}`
      : `${Math.round(thousands * 10) / 10}`;
  return `${text}k`;
}

/** `$0.31` once the amount is worth two digits, `$0.0042` below that. */
export function formatCostAmount(cost: number): string {
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

function percentText(value: number): string {
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
}

/**
 * The one line that says what this session has spent: occupancy, the cache
 * ratio, the output count and the cost. A group with no number behind it is
 * left out rather than shown as zero.
 */
export function contextUsageLine(input: UsageLineInput): string | undefined {
  const groups: string[] = [];

  const { labels } = input;
  const used = input.usedTokens;
  const limit = input.limitTokens;
  if (used !== undefined && limit !== undefined && limit > 0) {
    groups.push(
      `${labels.ctx} ${compactTokenCount(used)}/${compactTokenCount(limit)} (${percentText(
        (used / limit) * 100,
      )})`,
    );
  } else if (input.contextPercentage !== undefined) {
    groups.push(`${labels.ctx} ${percentText(input.contextPercentage)}`);
  }

  if (input.cacheHitRatio !== undefined && labels.cache) {
    groups.push(`${labels.cache} ${percentText(input.cacheHitRatio)}`);
  }
  if (input.outputTokens !== undefined && labels.out) {
    groups.push(`${labels.out} ${compactTokenCount(input.outputTokens)}`);
  }
  if (input.costGroup) {
    groups.push(input.costGroup);
  } else if (input.cost !== undefined && input.cost > 0 && labels.cost) {
    groups.push(`${labels.cost} ${formatCostAmount(input.cost)}`);
  }

  return groups.length > 0 ? groups.join(SEPARATOR) : undefined;
}
