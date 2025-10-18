import { describe, expect, it } from "vitest";

import { ServiceContainer } from "./ServiceContainer.js";

const SETTLE_EVENTS = ["ready", "error"];

/**
 * A reader that arrives while a service is still loading waits on the container
 * instead of starting a second load, and it registers a handler for both settle
 * events because either one can be the one that fires. The container raises its
 * own warning limit to 50 handlers per event, so a handler left for the event
 * that did not fire is silent until a long session has spent that allowance.
 */
describe("the reader that arrives while a service loads", () => {
  it("gives back both handlers when the load it waited on succeeds", async () => {
    const container = new ServiceContainer();
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    container.register("probe", () => gate);

    const loading = container.load("probe");
    const waiting = container.get("probe");

    for (const event of SETTLE_EVENTS) {
      expect(container.listenerCount(`probe:${event}`), event).toBe(1);
    }

    release("value");

    await expect(loading).resolves.toBe("value");
    await expect(waiting).resolves.toBe("value");
    for (const event of SETTLE_EVENTS) {
      expect(container.listenerCount(`probe:${event}`), event).toBe(0);
    }
  });

  it("gives back both handlers when the load it waited on fails", async () => {
    const container = new ServiceContainer();
    let fail!: (error: Error) => void;
    const gate = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    container.register("broken", () => gate);

    const loading = container.load("broken").catch((error: Error) => error);
    const waiting = container.get("broken").catch((error: Error) => error);

    for (const event of SETTLE_EVENTS) {
      expect(container.listenerCount(`broken:${event}`), event).toBe(1);
    }

    fail(new Error("factory died"));

    await expect(loading).resolves.toBeInstanceOf(Error);
    await expect(waiting).resolves.toBeInstanceOf(Error);
    for (const event of SETTLE_EVENTS) {
      expect(container.listenerCount(`broken:${event}`), event).toBe(0);
    }
  });
});
