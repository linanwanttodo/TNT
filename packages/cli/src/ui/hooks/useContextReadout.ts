import { useMemo } from "react";

import { getLastRequestCacheState } from "../../cache/lastRequestCacheState.js";
import { getTotalSessionCost } from "../../session/index.js";
import { formatContextUsage } from "../utils/contextReadout.js";

interface ContextData {
  tokenCount?: number | null;
  percentage?: number | null;
  contextWindow?: number;
}

/**
 * The line under the input box: the context share the provider measured, and
 * what the session has cost so far. Both are readouts, not counters: the
 * share is measured, and the cost is what the price table says the session
 * has spent.
 */
export function useContextReadout(
  contextData: ContextData | null | undefined,
  provider?: string,
): string | undefined {
  return useMemo(() => {
    if (!contextData) return undefined;
    const parts: string[] = [];
    parts.push(
      formatContextUsage({
        tokens: contextData.tokenCount ?? null,
        contextWindow: contextData.contextWindow ?? 0,
        percent: contextData.percentage ?? null,
      }),
    );
    // The cache hit rate of the last request, when the provider reported one.
    const cache = getLastRequestCacheState();
    if (cache && cache.hitRate > 0) {
      parts.push(`缓存 ${Math.round(cache.hitRate * 100)}%`);
    }
    // Only DeepSeek has a documented balance endpoint and a price table we
    // query directly. Other vendors keep the line to context/cache only.
    if (provider === "deepseek") {
      const cost = getTotalSessionCost();
      if (cost > 0) parts.push(`$${cost.toFixed(3)}`);
    }
    return parts.join(" · ");
  }, [contextData, provider]);
}
