import { describe, expect, it } from "vitest";

import { createTestServiceContainer } from "../test-utils/testServiceContainer.js";

/**
 * A service settles exactly once, so every waiter that listens for both the
 * `ready` and the `error` event leaves one listener behind unless it removes
 * the sibling. On a shared container those leftovers add up to a MaxListeners
 * warning in every gate run, which is how a real leak in the product gets
 * mistaken for harness noise.
 */
describe("the test service container's waiters", () => {
  it("attaches nothing that outlives a service coming up", async () => {
    const container = createTestServiceContainer();
    void container.load("model");

    const waited = container.waitForService("model");
    container.resolveService("model", { model: "gpt" });

    await expect(waited).resolves.toEqual({ model: "gpt" });
    expect(container.listenerCount("model:ready")).toBe(0);
    expect(container.listenerCount("model:error")).toBe(0);
  });

  it("attaches nothing that outlives a service failing", async () => {
    const container = createTestServiceContainer();
    // The loader's promise is the rejected one here, so it needs a handler or
    // the run ends with an unhandled rejection instead of a clean assertion.
    container.load("mcp").catch(() => undefined);

    const waited = container.waitForReady("mcp");
    container.rejectService("mcp", new Error("server died"));

    await waited;
    expect(container.listenerCount("mcp:ready")).toBe(0);
    expect(container.listenerCount("mcp:error")).toBe(0);
  });

  it("settles every name a multi-service wait asked for", async () => {
    const container = createTestServiceContainer();
    void container.load("config");
    void container.load("model");

    const waited = container.waitForReady("config", "model");
    container.resolveService("config", {});
    container.resolveService("model", {});

    await waited;
    for (const name of ["config", "model"]) {
      expect(container.listenerCount(`${name}:ready`), name).toBe(0);
      expect(container.listenerCount(`${name}:error`), name).toBe(0);
    }
  });
});
