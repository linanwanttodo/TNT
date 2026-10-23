import { describe, expect, it } from "vitest";

import {
  createTurnState,
  noteCompaction,
  noteRequestCompleted,
} from "./turnState.js";

describe("the state one turn owns", () => {
  it("starts every turn with its own empty system prompt series", () => {
    const first = createTurnState();
    first.systemPrompt.previous = "sent earlier";
    first.systemPrompt.request = "sent earlier";
    first.systemPrompt.updates = ["update"];

    // A system prompt comparison belongs to the turn that made it: a new prompt
    // must rewrite the field rather than inherit the previous turn's head.
    expect(createTurnState().systemPrompt).toEqual({ updates: [] });
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
