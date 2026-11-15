import { getLastRequestCacheState } from "../../cache/lastRequestCacheState.js";
import { t } from "../../i18n/index.js";
import { lastRoundCacheRate } from "../../stream/usageTelemetry.js";
import {
  formatContextUsage,
  formatStatusReadout,
} from "../utils/contextReadout.js";

interface ContextData {
  tokenCount?: number | null;
  percentage?: number | null;
  contextWindow?: number;
}

/**
 * The footer readout: the cache rate of the last round and the provider's
 * measured context share. Those are the two numbers that change on their own
 * while a session runs; the session's token arrows and its price are not put
 * on the footer, and `/cost` reports them on demand.
 */
export function useContextReadout(
  contextData: ContextData | null | undefined,
): string | undefined {
  const cache = getLastRequestCacheState();
  const rate = cache?.hitRate ?? lastRoundCacheRate();
  const context = contextData
    ? formatContextUsage({
        tokens: contextData.tokenCount ?? null,
        contextWindow: contextData.contextWindow ?? 0,
        percent: contextData.percentage ?? null,
      })
    : "";
  return (
    formatStatusReadout({
      rate,
      context,
      cacheLabel: t("status.cache"),
    }) || undefined
  );
}
