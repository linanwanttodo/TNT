/**
 * What the Fetch tool already read, so asking for the same page again - which
 * is what a paginated reader does - does not hit the network a second time.
 *
 * In-process and small on purpose: the CLI is one session, a fetch is minutes
 * old at most, and a page cached in one run should not answer for the next one.
 */
export const FETCH_CACHE_TTL_MS = 10 * 60_000;

/** Bounded so a loop over many URLs cannot grow the cache without limit. */
const MAX_ENTRIES = 50;

const entries = new Map<string, { text: string; at: number }>();

export function cachedFetch(
  url: string,
  now: number = Date.now(),
): string | undefined {
  const entry = entries.get(url);
  if (!entry) {
    return undefined;
  }
  if (now - entry.at >= FETCH_CACHE_TTL_MS) {
    entries.delete(url);
    return undefined;
  }
  // Re-insert so the map's order stays least-recently-used first.
  entries.delete(url);
  entries.set(url, entry);
  return entry.text;
}

export function rememberFetch(
  url: string,
  text: string,
  now: number = Date.now(),
): void {
  entries.delete(url);
  entries.set(url, { text, at: now });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}

export function clearFetchCache(): void {
  entries.clear();
}
