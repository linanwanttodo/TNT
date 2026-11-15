import { describe, expect, it } from "vitest";

import {
  registerShutdownCallback,
  runShutdownCallbacks,
} from "./processShutdown.js";

describe("the shutdown callback registry", () => {
  it("runs the latest callback per key", () => {
    const ran: string[] = [];
    registerShutdownCallback("replace-me", () => ran.push("stale"));
    registerShutdownCallback("replace-me", () => ran.push("current"));
    registerShutdownCallback("second-owner", () => ran.push("second"));

    runShutdownCallbacks();

    expect(ran).toEqual(["current", "second"]);
  });

  it("attaches one set of process listeners however many keys register", () => {
    const before = process.listenerCount("SIGTERM");
    registerShutdownCallback("first-key", () => {});
    const afterFirst = process.listenerCount("SIGTERM");
    registerShutdownCallback("another-key", () => {});
    registerShutdownCallback("a-third-key", () => {});

    expect(afterFirst).toBeLessThanOrEqual(before + 1);
    expect(process.listenerCount("SIGTERM")).toBe(afterFirst);
  });

  it("keeps running the remaining callbacks when one throws", () => {
    let survivorRan = false;
    registerShutdownCallback("throws", () => {
      throw new Error("teardown failed");
    });
    registerShutdownCallback("survivor", () => {
      survivorRan = true;
    });

    runShutdownCallbacks();

    expect(survivorRan).toBe(true);
  });
});
