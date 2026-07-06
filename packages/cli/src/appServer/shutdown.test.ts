import { describe, expect, it } from "vitest";

import { settleWithin } from "./shutdown.js";

describe("settleWithin", () => {
  it("returns true once every operation settles", async () => {
    await expect(
      settleWithin([Promise.resolve(), Promise.resolve()], 100),
    ).resolves.toBe(true);
  });

  it("returns false when an operation outlives the bound", async () => {
    const started = Date.now();
    const stalled = new Promise<void>(() => undefined);

    await expect(settleWithin([stalled], 20)).resolves.toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
