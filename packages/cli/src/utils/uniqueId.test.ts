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
  const names = ["TNT_USER_ID", "CONTINUE_USER_ID"];
  afterEach(() => {
    for (const name of names) {
      delete process.env[name];
    }
  });

  it("prefers TNT_USER_ID", async () => {
    process.env.TNT_USER_ID = "tnt-id";
    process.env.CONTINUE_USER_ID = "legacy-id";
    const { getUniqueId } = await load();
    expect(getUniqueId()).toBe("tnt-id");
  });

  it("still honors CONTINUE_USER_ID when the TNT name is absent", async () => {
    process.env.CONTINUE_USER_ID = "legacy-id";
    const { getUniqueId } = await load();
    expect(getUniqueId()).toBe("legacy-id");
  });

  it("falls back to a stable machine id when neither is set", async () => {
    const { getUniqueId } = await load();
    const first = getUniqueId();
    expect(first).toBeTruthy();
    process.env.TNT_USER_ID = "too-late";
    expect(getUniqueId()).toBe(first);
  });
});
