import { describe, expect, it } from "vitest";

import {
  clearSeriesSectionBaselines,
  resetSystemPromptSeries,
  systemPromptSeriesState,
} from "./systemPromptSeries.js";

describe("the session-scoped system prompt series", () => {
  it("hands the same state back across turns of one conversation", () => {
    resetSystemPromptSeries("s1");
    const first = systemPromptSeriesState("s1");
    first.previous = "the cached head";

    expect(systemPromptSeriesState("s1")).toBe(first);
  });

  it("keeps conversations apart", () => {
    resetSystemPromptSeries("a");
    resetSystemPromptSeries("b");

    expect(systemPromptSeriesState("a")).not.toBe(systemPromptSeriesState("b"));
  });

  it("gives a delegated override its own series, not the parent's", () => {
    resetSystemPromptSeries("parent");
    const parent = systemPromptSeriesState("parent");
    const child = systemPromptSeriesState("parent", "you are a subagent");

    expect(child).not.toBe(parent);
    child.previous = "child head";
    expect(parent.previous).toBeUndefined();
  });

  it("drops every series of a conversation on reset, overrides included", () => {
    systemPromptSeriesState("s2");
    systemPromptSeriesState("s2", "subagent prompt");

    resetSystemPromptSeries("s2");

    expect(systemPromptSeriesState("s2").previous).toBeUndefined();
  });

  it("keeps the conversation making rounds and evicts only stale entries", () => {
    resetSystemPromptSeries("live");
    const live = systemPromptSeriesState("live");
    live.previous = "the live head";

    // Every request borrows the series, so the live conversation is read as
    // the fillers pile up; the eviction must always land on an entry nobody
    // has touched since.
    for (let i = 0; i < 40; i++) {
      systemPromptSeriesState(`filler-${i}`);
      expect(systemPromptSeriesState("live")).toBe(live);
    }
  });

  it("clears one series' section baselines without touching the series itself", async () => {
    resetSystemPromptSeries("rewind");
    const state = systemPromptSeriesState("rewind");
    const { createSectionBaselines } =
      await import("./systemMessageReinjection.js");
    const baselines = createSectionBaselines();
    baselines.byId.set("base", {
      prefix: { snapshot: { id: "base", hash: "h", text: "BASE" } },
      told: {
        snapshot: { id: "base", hash: "h", text: "BASE" },
        via: "prefix",
      },
    });
    state.sections = baselines;
    state.previous = "the remembered head";

    clearSeriesSectionBaselines("rewind");

    // The section facts are gone, but the cached head the provider still has
    // stays remembered - a rollback is not a reason to re-bill the prefix.
    expect(baselines.byId.size).toBe(0);
    expect(state.previous).toBe("the remembered head");

    // Idempotent, and safe for a series that never planned sections.
    clearSeriesSectionBaselines("rewind");
    clearSeriesSectionBaselines("never-planned");
  });
});
