import type { SessionUsage } from "core/index.js";

/**
 * Cache hit ratio for the session, expressed as a whole percentage.
 *
 * Providers disagree on whether the prompt total includes the cached slice.
 * When it does, the prompt total is the denominator. When the cached and
 * written slices exceed it, they are counted on top, which is how providers
 * that bill cache separately report a turn. Returns undefined when nothing has
 * been sent yet so callers can hide the field instead of showing a
 * misleading 0%.
 */
export function getCacheHitRatio(
  usage?: SessionUsage | null,
): number | undefined {
  const details = usage?.promptTokensDetails;
  const cachedTokens = details?.cachedTokens ?? 0;
  const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
  const promptTokens = usage?.promptTokens ?? 0;

  if (cachedTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined;
  }

  const cacheTokens = cachedTokens + cacheWriteTokens;
  const denominator =
    promptTokens >= cacheTokens ? promptTokens : promptTokens + cacheTokens;
  if (denominator <= 0) {
    return undefined;
  }

  return Math.min(100, Math.round((cachedTokens / denominator) * 100));
}
