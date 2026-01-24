/**
 * The aggregate floor a session's cache hit rate has to clear. The last rounds
 * are the ones a session pays for again and again, so they are the sample the
 * floor is measured on; an early cold round is not allowed to hide a tail that
 * stopped reading the cache.
 *
 * A stable prefix only grows, so almost every prompt token should come back as
 * a cache read. The floor starts at the rate this client already reaches in a
 * controlled run, not at a comfortable lower bound; a provider whose cache
 * economics differ can override it.
 */
export const CACHE_HIT_TAIL_ROUNDS = 3;
export const DEFAULT_CACHE_HIT_FLOOR = 0.95;

/**
 * The floor, overridable by environment for a provider whose cache economics
 * differ. A value outside (0, 1] is not a ratio and falls back to the default
 * rather than making the guard unfalsifiable.
 */
export function cacheHitFloor(
  raw = process.env.CONTINUE_CLI_CACHE_HIT_FLOOR,
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_CACHE_HIT_FLOOR;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_CACHE_HIT_FLOOR;
  }
  return parsed;
}

/**
 * Mean hit rate of the last `rounds` samples, or undefined when the session
 * has not produced that many. Undefined is not a pass: a guard that reported
 * success on no evidence would be silent on the shortest sessions.
 */
export function tailCacheHitRate(
  rates: readonly number[],
  rounds = CACHE_HIT_TAIL_ROUNDS,
): number | undefined {
  if (rates.length < rounds) {
    return undefined;
  }
  const tail = rates.slice(-rounds);
  return tail.reduce((sum, rate) => sum + rate, 0) / tail.length;
}

export function meetsCacheHitFloor(
  rates: readonly number[],
  floor = cacheHitFloor(),
): boolean {
  const rate = tailCacheHitRate(rates);
  return rate !== undefined && rate >= floor;
}
