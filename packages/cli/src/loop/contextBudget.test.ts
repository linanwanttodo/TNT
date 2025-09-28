import {
  CONTEXT_BUDGET_FRACTION,
  ContextBudgetTracker,
} from "./contextBudget.js";

describe("ContextBudgetTracker", () => {
  it("says nothing before a request has measured the window", () => {
    const tracker = new ContextBudgetTracker();
    expect(tracker.reminder(100_000)).toBeUndefined();
  });

  it("says nothing while most of the window is left", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(10_000);
    expect(tracker.reminder(100_000)).toBeUndefined();
  });

  it("warns once the remainder falls to the threshold, naming the numbers", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(
      100_000 - Math.floor(100_000 * CONTEXT_BUDGET_FRACTION),
    );

    const notice = tracker.reminder(100_000);
    expect(notice).toContain("20,000 tokens");
    expect(notice).toContain("100,000 window");
  });

  it("does not repeat itself while the window stays full", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(95_000);

    expect(tracker.reminder(100_000)).toBeDefined();
    expect(tracker.reminder(100_000)).toBeUndefined();
    tracker.recordRequest(98_000);
    expect(tracker.reminder(100_000)).toBeUndefined();
  });

  it("arms again after the window opens back up", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(95_000);
    expect(tracker.reminder(100_000)).toBeDefined();

    // A compaction, measured by the next request being smaller.
    tracker.recordRequest(20_000);
    expect(tracker.reminder(100_000)).toBeUndefined();
    tracker.recordRequest(95_000);
    expect(tracker.reminder(100_000)).toBeDefined();
  });

  it("stays quiet when the window size is unknown", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(95_000);

    expect(tracker.reminder(undefined)).toBeUndefined();
    expect(tracker.reminder(0)).toBeUndefined();
  });

  it("keeps the last measured request when a round reports no usage", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(95_000);
    tracker.recordRequest(undefined);

    expect(tracker.reminder(100_000)).toContain("5,000 tokens");
  });
});
