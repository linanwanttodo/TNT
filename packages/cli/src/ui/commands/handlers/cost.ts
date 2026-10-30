import { services } from "../../../services/index.js";
import { getSessionUsage } from "../../../session/index.js";
import { getModelContextLimit } from "../../../utils/tokenizer.js";
import {
  compactTokenCount,
  formatCostAmount,
} from "../../utils/contextUsageLine.js";
import type { SlashCommandResult } from "../types.js";

function percent(ratio: number): string {
  return `${(Math.min(100, Math.max(0, ratio)) * 100).toFixed(1)}%`;
}

/**
 * The spend and context report the status row no longer carries: context
 * occupancy, the cache hit ratio, output tokens and the cost - the numbers
 * a reader watches live, on demand instead of always.
 */
export function handleCost(): SlashCommandResult {
  const usage = getSessionUsage();
  const lines: string[] = [];

  const model = services.model?.getState().model as
    Parameters<typeof getModelContextLimit>[0] | null | undefined;
  if (model) {
    const limit = getModelContextLimit(model);
    // The last request's prompt is the context the next one re-sends, so the
    // session's prompt sum overstates occupancy; the ratio uses the limit
    // against what the model will actually carry.
    const contextTokens = usage.promptTokens;
    if (contextTokens > 0) {
      lines.push(
        `Context: ${compactTokenCount(contextTokens)} / ${compactTokenCount(limit)} (${percent(contextTokens / limit)})`,
      );
    }
  }

  const input = usage.promptTokens;
  const cached = usage.promptTokensDetails?.cachedTokens ?? 0;
  if (input > 0 && cached > 0) {
    lines.push(
      `Cache hit: ${percent(cached / input)} (${compactTokenCount(cached)})`,
    );
  }

  lines.push(`Output: ${compactTokenCount(usage.completionTokens)} tokens`);

  if (usage.totalCost > 0) {
    lines.push(
      `Cost: ${formatCostAmount(usage.totalCost)}${
        usage.unpricedRequests ? ` (+${usage.unpricedRequests} unpriced)` : ""
      }`,
    );
  }

  if (usage.compaction) {
    lines.push(
      `Compaction: ${usage.compaction.requests} request(s), ${formatCostAmount(usage.compaction.cost)}`,
    );
  }

  if (lines.length === 0) {
    return { output: "No usage yet this session." };
  }
  return { output: lines.join("\n") };
}
