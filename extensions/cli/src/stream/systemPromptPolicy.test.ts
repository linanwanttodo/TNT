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
        startsSeries: false,
      }),
    ).toEqual({ action: "append", appendedPrompt: "new" });
  });
});
