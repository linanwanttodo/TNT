import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_HIT_TAIL_ROUNDS,
  DEFAULT_CACHE_HIT_FLOOR,
  cacheHitFloor,
  meetsCacheHitFloor,
  tailCacheHitRate,
} from "./cacheHitGuard.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cacheHitFloor", () => {
  it("starts from the rate a stable prefix can reach", () => {
    expect(DEFAULT_CACHE_HIT_FLOOR).toBe(0.95);
    expect(CACHE_HIT_TAIL_ROUNDS).toBe(3);
    expect(cacheHitFloor(undefined)).toBe(0.95);
  });

  it("takes a ratio from the environment", () => {
    vi.stubEnv("TNT_CACHE_HIT_FLOOR", "0.99");
    expect(cacheHitFloor()).toBe(0.99);
  });

  it("falls back rather than accepting a value that is not a ratio", () => {
    for (const raw of ["", "0", "-0.1", "1.1", "not-a-number"]) {
      expect(cacheHitFloor(raw), raw).toBe(DEFAULT_CACHE_HIT_FLOOR);
    }
    expect(cacheHitFloor("1")).toBe(1);
  });
});

describe("tailCacheHitRate", () => {
  it("measures only the tail", () => {
    expect(tailCacheHitRate([0.1, 0.2, 0.9, 0.91, 0.92])).toBeCloseTo(0.91, 4);
  });

  it("has no answer before the tail exists", () => {
    expect(tailCacheHitRate([0.9, 0.95])).toBeUndefined();
    expect(meetsCacheHitFloor([0.9, 0.95])).toBe(false);
  });
});

describe("meetsCacheHitFloor", () => {
  it("passes a warm tail", () => {
    expect(meetsCacheHitFloor([0, 0.96, 0.97, 0.98])).toBe(true);
  });

  it("fails a tail that stopped reading the cache", () => {
    // The reverse control: without this the threshold could never red.
    const drifted = [0.97, 0.96, 0.2, 0.1, 0.05];
    expect(tailCacheHitRate(drifted)).toBeCloseTo(0.1167, 4);
    expect(meetsCacheHitFloor(drifted)).toBe(false);
  });

  it("honours an override", () => {
    const rates = [0.96, 0.96, 0.96];
    expect(meetsCacheHitFloor(rates, 0.95)).toBe(true);
    expect(meetsCacheHitFloor(rates, 0.99)).toBe(false);
  });
});
