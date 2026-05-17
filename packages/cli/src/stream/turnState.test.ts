import { describe, expect, it } from "vitest";

import { resetSystemPromptSeries } from "./systemPromptSeries.js";
import {
  createTurnState,
  noteCompaction,
  noteRequestCompleted,
} from "./turnState.js";

describe("the state one turn owns", () => {
  it("continues the same system prompt series across turns", async () => {
    resetSystemPromptSeries("series-test");
    const first = createTurnState(undefined, "series-test");
    first.systemPrompt.previous = "sent earlier";
    first.systemPrompt.request = "sent earlier";
    first.systemPrompt.updates = ["update"];

    // The system field and its updates are the bytes the provider has cached;
    // a new turn that reset them would rewrite the head and re-bill it. The
    // new turn borrows the same series object, so its first round compares
    // against what was actually sent and can keep the prefix.
    const next = createTurnState(undefined, "series-test");
    expect(next.systemPrompt).toBe(first.systemPrompt);
  });

  it("remembers that a compaction rewrote the history", () => {
    const state = createTurnState();

    noteCompaction(state);

    expect(state.compactionOccurred).toBe(true);
    expect(state.historyRewritten).toBe(true);
  });

  it("clears the rewritten flag once a request has gone out", () => {
    const state = createTurnState();
    noteCompaction(state);

    noteRequestCompleted(state);

    expect(state.coldTurn).toBe(false);
    expect(state.historyRewritten).toBe(false);
  });
});
