import { describe, expect, it } from "vitest";

import { ToolFailureTracker } from "./toolFailureTracker.js";

describe("ToolFailureTracker", () => {
  it("counts failures per tool rather than across all tools", () => {
    const tracker = new ToolFailureTracker({ threshold: 3 });

    tracker.record("shell", false, "tests failed");
    tracker.record("grep", false, "no match");
    tracker.record("shell", false, "tests failed");

    // The grep failure must not add to shell's streak.
    expect(tracker.consecutiveFailures("shell")).toBe(2);
    expect(tracker.consecutiveFailures("grep")).toBe(1);
  });

  it("notifies once when a tool reaches the threshold", () => {
    const tracker = new ToolFailureTracker({ threshold: 3 });

    expect(tracker.record("shell", false, "a")).toBeUndefined();
    expect(tracker.record("shell", false, "b")).toBeUndefined();
    expect(tracker.record("shell", false, "c")).toEqual({
      toolName: "shell",
      consecutiveFailures: 3,
      lastError: "c",
    });
    // A fourth failure does not re-notify for the same streak.
    expect(tracker.record("shell", false, "d")).toBeUndefined();
  });

  it("clears the streak on success so the tool can alert again later", () => {
    const tracker = new ToolFailureTracker({ threshold: 2 });

    tracker.record("shell", false, "a");
    expect(tracker.record("shell", false, "b")).toBeDefined();

    tracker.record("shell", true);
    expect(tracker.consecutiveFailures("shell")).toBe(0);

    tracker.record("shell", false, "c");
    expect(tracker.record("shell", false, "d")).toBeDefined();
  });

  it("collapses whitespace so a multi-line error stays one line", () => {
    const tracker = new ToolFailureTracker({ threshold: 1 });

    const notice = tracker.record("shell", false, "line one\n  line two");
    expect(notice?.lastError).toBe("line one line two");
  });
});
