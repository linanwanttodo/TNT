import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getLatestVersion` caches its first answer for the process lifetime, so each case starts
 * from a fresh module instance rather than resetting a cache it does not expose.
 */
async function freshModule() {
  vi.resetModules();
  return (await import("./version.js")) as typeof import("./version.js");
}

function releaseResponse(tag: string | null, ok = true) {
  return {
    ok,
    json: async () => ({ tag_name: tag }),
  };
}

describe("the latest-version probe", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the releases API once and caches the answer", async () => {
    const fetchMock = vi.fn(async () => releaseResponse("v9.9.9"));
    vi.stubGlobal("fetch", fetchMock);
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBe("9.9.9");
    await expect(getLatestVersion()).resolves.toBe("9.9.9");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than throwing when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => releaseResponse(null, false)),
    );
    const { getLatestVersion } = await freshModule();

    await expect(getLatestVersion()).resolves.toBeNull();
  });
});
