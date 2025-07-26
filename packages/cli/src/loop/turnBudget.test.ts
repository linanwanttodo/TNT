import { describe, expect, it } from "vitest";

import { TurnBudget } from "./turnBudget.js";

describe("TurnBudget", () => {
  it("reports steps exhausted once the round ceiling is reached", () => {
    const budget = new TurnBudget({ maxSteps: 3 });

    expect(budget.recordStep(1000)).toBe("ok");
    expect(budget.recordStep(1000)).toBe("ok");
    expect(budget.recordStep(1000)).toBe("steps_exhausted");
    expect(budget.stepsExhausted).toBe(true);
  });

  it("stops after enough rounds add almost nothing", () => {
    const budget = new TurnBudget({
      diminishingReturnsThreshold: 3,
      diminishingTokenThreshold: 500,
    });

    expect(budget.recordStep(10)).toBe("ok");
    expect(budget.recordStep(10)).toBe("ok");
    expect(budget.recordStep(10)).toBe("diminishing_returns");
  });

  it("clears the stalling tally as soon as a round makes real progress", () => {
    const budget = new TurnBudget({
      diminishingReturnsThreshold: 3,
      diminishingTokenThreshold: 500,
    });

    budget.recordStep(10);
    budget.recordStep(10);
    expect(budget.diminishingRoundsStuck).toBe(false);

    // A round that produced real content resets the run of stalled rounds.
    budget.recordStep(5000);
    expect(budget.diminishingRoundsStuck).toBe(false);
    expect(budget.recordStep(10)).toBe("ok");
  });

  it("treats a compaction that barely shrank history as a failure", () => {
    const budget = new TurnBudget({
      maxConsecutiveCompactionFailures: 2,
      compactionMinReductionRatio: 0.05,
    });

    expect(budget.recordCompaction(0.4)).toBe(true);
    expect(budget.recordCompaction(0.01)).toBe(false);
    expect(budget.compactionCircuitOpen).toBe(false);
    expect(budget.recordCompaction(undefined)).toBe(false);
    expect(budget.compactionCircuitOpen).toBe(true);
  });

  it("clears the compaction failure run after a useful compaction", () => {
    const budget = new TurnBudget({ maxConsecutiveCompactionFailures: 2 });

    budget.recordCompaction(0.01);
    expect(budget.recordCompaction(0.5)).toBe(true);
    expect(budget.compactionCircuitOpen).toBe(false);
  });

  it("starts from zero on reset", () => {
    const budget = new TurnBudget({ maxSteps: 1 });

    budget.recordStep(0);
    expect(budget.stepsExhausted).toBe(true);

    budget.resetForNewTurn();
    expect(budget.stepsExhausted).toBe(false);
    expect(budget.diminishingRoundsStuck).toBe(false);
  });
});
