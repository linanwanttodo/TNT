import { describe, expect, it, vi } from "vitest";

import { flushTransports, resolveLogLevel } from "./logger.js";

describe("resolveLogLevel", () => {
  it("accepts every level the logger knows", () => {
    expect(resolveLogLevel("debug")).toBe("debug");
    expect(resolveLogLevel("info")).toBe("info");
  });

  it("ignores case and surrounding space", () => {
    expect(resolveLogLevel("  DEBUG ")).toBe("debug");
  });

  it("ignores a level it does not know", () => {
    expect(resolveLogLevel("verbose")).toBeUndefined();
    expect(resolveLogLevel("")).toBeUndefined();
    expect(resolveLogLevel(undefined)).toBeUndefined();
  });
});

describe("flushTransports", () => {
  it("waits for a transport that reports done", async () => {
    const close = vi.fn((callback?: () => void) => callback?.());
    let settled = false;

    await flushTransports([{ close }]).then(() => {
      settled = true;
    });

    expect(close).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
  });

  it("resolves when a transport has nothing to close", async () => {
    await expect(flushTransports([{}])).resolves.toBeUndefined();
  });

  it("resolves when closing throws", async () => {
    const close = vi.fn(() => {
      throw new Error("already closed");
    });

    await expect(flushTransports([{ close }])).resolves.toBeUndefined();
  });

  it("gives up on a transport that never reports done", async () => {
    const close = vi.fn();

    await expect(flushTransports([{ close }], 10)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
