import { describe, expect, it } from "vitest";

import { TurnBudget } from "./turnBudget.js";

describe("TurnBudget", () => {
  it("reports steps exhausted once the round ceiling is reached", () => {
    const budget = new TurnBudget({ maxSteps: 3 });

    expect(budget.recordStep()).toBe("ok");
    expect(budget.recordStep()).toBe("ok");
    expect(budget.recordStep()).toBe("steps_exhausted");
    expect(budget.stepsExhausted).toBe(true);
  });

  it("has no round ceiling unless one is configured", () => {
    // The default is the product behaviour: a turn that keeps making tool
    // calls keeps running. Ten thousand rounds is far past any ceiling the
    // loop ever had, so a reintroduced default shows up here.
    const budget = new TurnBudget();

    for (let round = 0; round < 10_000; round += 1) {
      expect(budget.recordStep()).toBe("ok");
    }
    expect(budget.stepsExhausted).toBe(false);
  });

  it("treats an explicitly undefined limit as no limit", () => {
    // `--max-steps` absent reaches the budget as `{ maxSteps: undefined }`.
    const budget = new TurnBudget({ maxSteps: undefined });

    for (let round = 0; round < 500; round += 1) {
      expect(budget.recordStep()).toBe("ok");
    }
    expect(budget.stepsExhausted).toBe(false);
  });

  it("keeps counting short tool rounds as progress", () => {
    // A tool round usually carries less than 500 completion tokens. It is
    // still progress, so the only bound is the step ceiling: 40 rounds in a
    // row must not end the turn early.
    const budget = new TurnBudget({ maxSteps: 100 });

    for (let round = 0; round < 40; round += 1) {
      expect(budget.recordStep()).toBe("ok");
    }
    expect(budget.stepsExhausted).toBe(false);
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

    budget.recordStep();
    expect(budget.stepsExhausted).toBe(true);

    budget.resetForNewTurn();
    expect(budget.stepsExhausted).toBe(false);
  });
});
