import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { GoalIndicator, truncateGoal } from "./GoalIndicator.js";

vi.mock("../../session/index.js", () => ({
  getSessionGoal: vi.fn(() => undefined),
}));

describe("truncateGoal", () => {
  it("collapses whitespace", () => {
    expect(truncateGoal("ship  the   cli\nresume")).toBe("ship the cli resume");
  });

  it("keeps the head and tail when longer than the limit", () => {
    const goal = "a".repeat(60) + "b".repeat(60);
    const truncated = truncateGoal(goal, 20);
    expect(truncated.length).toBe(20);
    expect(truncated.startsWith("aaaa")).toBe(true);
    expect(truncated.endsWith("bbbb")).toBe(true);
    expect(truncated).toContain("...");
  });

  it("returns short goals unchanged", () => {
    expect(truncateGoal("one small goal", 80)).toBe("one small goal");
  });
});

describe("GoalIndicator", () => {
  it("renders nothing when no goal is set", async () => {
    const { lastFrame } = render(<GoalIndicator />);
    expect(lastFrame()).not.toContain("Goal:");
  });

  it("renders the goal line above the composer", async () => {
    const sessionModule = (await vi.importMock(
      "../../session/index.js",
    )) as any;
    sessionModule.getSessionGoal.mockReturnValue(
      "Ship the TNT cli resume flow",
    );

    const { lastFrame } = render(<GoalIndicator />);

    expect(lastFrame()).toContain("Goal:");
    expect(lastFrame()).toContain("Ship the TNT cli resume flow");
  });
});
