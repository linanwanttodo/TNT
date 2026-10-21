import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

/**
 * `getLatestVersion` caches its first answer for the process lifetime, so each case starts
 * from a fresh module instance rather than resetting a cache it does not expose.
 */
async function freshModule() {
  vi.resetModules();
  return (await import("./version.js")) as typeof import("./version.js");
}

describe("the latest-version probe", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("asks npm once and caches the answer", async () => {
    vi.mocked(execFileSync).mockReturnValue("9.9.9\n");
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBe("9.9.9");
    await expect(getLatestVersion()).resolves.toBe("9.9.9");

    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than throwing when npm is unavailable", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("spawn npm ENOENT");
    });
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBeNull();
  });
});
