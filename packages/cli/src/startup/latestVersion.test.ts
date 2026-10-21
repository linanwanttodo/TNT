import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

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
    vi.mocked(execFile).mockReset();
  });

  it("asks npm once and caches the answer", async () => {
    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: Function,
    ) => {
      cb(null, "9.9.9\n");
    }) as never);
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBe("9.9.9");
    await expect(getLatestVersion()).resolves.toBe("9.9.9");

    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than throwing when npm is unavailable", async () => {
    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: Function,
    ) => {
      cb(new Error("spawn npm ENOENT"), "");
    }) as never);
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBeNull();
  });
});
