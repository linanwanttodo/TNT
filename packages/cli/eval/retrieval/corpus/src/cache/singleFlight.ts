import { TtlCache } from "./ttlCache.js";

/**
 * One in-flight load per key: callers that arrive while a value is being
 * fetched share the same promise instead of each starting their own load, and
 * whatever the winner resolves with lands in the cache behind it.
 */
export class SingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  constructor(private readonly cache: TtlCache<T>) {}

  async load(key: string, fetch: () => Promise<T>, now: number): Promise<T> {
    const cached = this.cache.get(key, now);
    if (cached !== undefined) {
      return cached;
    }

    const running = this.pending.get(key);
    if (running) {
      return running;
    }

    const started = fetch().then((value) => {
      this.pending.delete(key);
      this.cache.set(key, value, now);
      return value;
    });
    this.pending.set(key, started);
    return started;
  }

  get inflight(): number {
    return this.pending.size;
  }
}
