/**
 * A map that forgets its own entries. Every value carries the instant it was
 * written, and a read that finds one older than the ttl drops it instead of
 * returning a stale answer.
 */
export interface CacheEntry<T> {
  value: T;
  writtenAt: number;
}

export const DEFAULT_TTL_MS = 30_000;

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  set(key: string, value: T, now: number): void {
    this.entries.set(key, { value, writtenAt: now });
  }

  get(key: string, now: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (now - entry.writtenAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  get size(): number {
    return this.entries.size;
  }
}
