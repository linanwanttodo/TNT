import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Each case reloads the module because the id is memoized in a module global, and the
 * memoization is part of the contract: one install presents one identity per process, so a
 * second read must not re-derive - and re-deriving on every request would also make the
 * correlation header drift within a session.
 */
const load = async () => {
  vi.resetModules();
  return await import("./uniqueId.js");
};

describe("getUniqueId", () => {
  afterEach(() => {
    delete process.env.TNT_USER_ID;
    delete process.env.CONTINUE_USER_ID;
  });

  it("reads the one name", async () => {
    process.env.TNT_USER_ID = "tnt-id";
    const { getUniqueId } = await load();
    expect(getUniqueId()).toBe("tnt-id");
  });

  it("does not read the retired spelling", async () => {
    // The rename shipped without a compatibility read. This fails the moment a
    // fallback comes back, which is the point: an identity read from a stale
    // variable would present a different user depending on the shell.
    process.env.CONTINUE_USER_ID = "legacy-id";
    const { getUniqueId } = await load();
    expect(getUniqueId()).not.toBe("legacy-id");
  });

  it("falls back to a stable machine id when neither is set", async () => {
    const { getUniqueId } = await load();
    const first = getUniqueId();
    expect(first).toBeTruthy();
    process.env.TNT_USER_ID = "too-late";
    expect(getUniqueId()).toBe(first);
  });
});
