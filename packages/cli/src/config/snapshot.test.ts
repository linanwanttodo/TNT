import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/index.js", () => ({
  services: {
    toolPermissions: {
      getState: () => ({ currentMode: "acceptEdits" }),
      isHeadless: () => true,
    },
  },
}));

vi.mock("../cache/promptCacheKey.js", () => ({
  currentPromptCacheKey: () => "cache-slot",
}));

import {
  captureRunSnapshot,
  getRunSnapshot,
  resetRunSnapshot,
} from "./snapshot.js";

afterEach(() => {
  resetRunSnapshot();
});

describe("run config snapshot", () => {
  it("captures mode, headless, and session once", () => {
    const snapshot = captureRunSnapshot();

    expect(snapshot).toMatchObject({
      sessionId: "cache-slot",
      mode: "acceptEdits",
      isHeadless: true,
      revision: 1,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("lets an explicit override win and increments the revision", () => {
    const first = captureRunSnapshot({ mode: "plan" });
    const second = captureRunSnapshot({ sessionId: "other" });

    expect(first.mode).toBe("plan");
    expect(second.revision).toBe(2);
    expect(getRunSnapshot()).toBe(second);
  });
});
