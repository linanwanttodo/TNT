import { getLastRequestCacheState } from "../../cache/lastRequestCacheState.js";
import { getSessionUsage } from "../../session/index.js";
import { lastRoundCacheRate } from "../../stream/usageTelemetry.js";
import {
  formatContextUsage,
  formatSessionReadout,
} from "../utils/contextReadout.js";

interface ContextData {
  tokenCount?: number | null;
  percentage?: number | null;
  contextWindow?: number;
}

/**
 * The status line, computed pi's way and recomputed on every render: the
 * session's cumulative arrows tick live while the answer streams, the cache
 * rate belongs to the last round, and the context share is the provider's
 * measurement against the model window. The streaming estimate keeps the
 * arrow moving between rounds; the round's own numbers correct it on arrival.
 */
export function useContextReadout(
  contextData: ContextData | null | undefined,
  provider?: string,
  streamingText?: string | null,
  streamingReasoning?: string | null,
): string | undefined {
  const streamingTokens =
    streamingText || streamingReasoning
      ? Math.round(
          ((streamingText?.length ?? 0) + (streamingReasoning?.length ?? 0)) /
            4,
        )
      : 0;
  const usage = getSessionUsage();
  const cache = getLastRequestCacheState();
  const rate = cache?.hitRate ?? lastRoundCacheRate();
  const context = contextData
    ? formatContextUsage({
        tokens: contextData.tokenCount ?? null,
        contextWindow: contextData.contextWindow ?? 0,
        percent: contextData.percentage ?? null,
      })
    : "";
  const readout = formatSessionReadout(
    {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cacheReadTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
      cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
      totalCost: usage.totalCost,
    },
    streamingTokens,
    rate,
    context,
  );
  return readout || undefined;
}
