import { DEFAULT_TTL_MS, TtlCache } from "./ttlCache.js";

/**
 * The expiry behaviour is asserted here, so this file names the same symbols
 * as the implementation without defining either of them.
 */
describe("TtlCache", () => {
  it("keeps a value written inside the window", () => {
    const cache = new TtlCache<string>();
    cache.set("order-1", "held", 1_000);
    expect(cache.get("order-1", 1_000 + DEFAULT_TTL_MS - 1)).toBe("held");
  });

  it("drops a value written before the window", () => {
    const cache = new TtlCache<string>();
    cache.set("order-1", "held", 1_000);
    expect(cache.get("order-1", 1_000 + DEFAULT_TTL_MS + 1)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("honours a ttl shorter than the default", () => {
    const cache = new TtlCache<number>(5);
    cache.set("ticks", 3, 100);
    expect(cache.get("ticks", 106)).toBeUndefined();
  });
});
