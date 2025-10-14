import { describe, expect, it } from "vitest";

import { decideSystemPrompt } from "./systemPromptPolicy.js";

describe("decideSystemPrompt", () => {
  it("rewrites on the first request in a series", () => {
    expect(
      decideSystemPrompt({
        previous: undefined,
        next: "instructions",
        supportsInHistoryUpdate: true,
        startsSeries: true,
      }),
    ).toEqual({ action: "rewrite" });
  });

  it("keeps an unchanged prompt", () => {
    expect(
      decideSystemPrompt({
        previous: "same",
        next: "same",
        supportsInHistoryUpdate: true,
        startsSeries: false,
      }),
    ).toEqual({ action: "keep" });
  });

  it("rewrites when the prompt is cleared", () => {
    expect(
      decideSystemPrompt({
        previous: "old",
        next: "",
        supportsInHistoryUpdate: true,
        startsSeries: false,
      }),
    ).toEqual({ action: "rewrite" });
  });

  it("rewrites when the route cannot place a system message in history", () => {
    expect(
      decideSystemPrompt({
        previous: "old",
        next: "new",
        supportsInHistoryUpdate: false,
        startsSeries: false,
      }),
    ).toEqual({ action: "rewrite" });
  });

  it("appends a changed prompt on a supporting route", () => {
    expect(
      decideSystemPrompt({
        previous: "old",
        next: "new",
        supportsInHistoryUpdate: true,
        carriesInHistory: true,
        startsSeries: false,
      }),
    ).toEqual({ action: "append", appendedPrompt: "new" });
  });

  describe("who says the dialect can carry it", () => {
    it("appends when the adapter declares it and nothing was configured", () => {
      expect(
        decideSystemPrompt({
          previous: "A",
          next: "B",
          carriesInHistory: true,
          startsSeries: false,
        }),
      ).toEqual({ action: "append", appendedPrompt: "B" });
    });

    it("rewrites when the adapter does not declare it and nothing was configured", () => {
      // The hoisting adapters keep only the first system message, so an append
      // there would drop the instruction rather than delay it.
      expect(
        decideSystemPrompt({
          previous: "A",
          next: "B",
          carriesInHistory: false,
          startsSeries: false,
        }).action,
      ).toBe("rewrite");
      expect(
        decideSystemPrompt({ previous: "A", next: "B", startsSeries: false })
          .action,
      ).toBe("rewrite");
    });

    it("appends on a declared false when the configuration insists, and says so", () => {
      const decision = decideSystemPrompt({
        previous: "A",
        next: "B",
        supportsInHistoryUpdate: true,
        carriesInHistory: false,
        startsSeries: false,
      });
      expect(decision.action).toBe("append");
      expect(decision.forcesUnsupportedDialect).toBe(true);
    });

    it("lets the configuration refuse even a willing dialect", () => {
      expect(
        decideSystemPrompt({
          previous: "A",
          next: "B",
          supportsInHistoryUpdate: false,
          carriesInHistory: true,
          startsSeries: false,
        }).action,
      ).toBe("rewrite");
    });
  });
});
