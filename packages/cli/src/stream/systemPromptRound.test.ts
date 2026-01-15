import { describe, expect, it } from "vitest";

import {
  advanceSystemPrompt,
  type SystemPromptRoundState,
} from "./systemPromptRound.js";

function makeState(
  partial: Partial<SystemPromptRoundState> = {},
): SystemPromptRoundState {
  return { updates: [], ...partial };
}

describe("the system prompt state a round moves", () => {
  it("rewrites the field on the first round of a series", () => {
    const state = makeState();
    const result = advanceSystemPrompt({
      state,
      next: "first prompt",
      modelName: "test-model",
      carriesInHistory: true,
    });

    expect(result.systemMessage).toBe("first prompt");
    expect(state).toEqual({
      previous: "first prompt",
      request: "first prompt",
      updates: [],
    });
  });

  it("leaves the prefix alone when the prompt did not move", () => {
    const state = makeState({
      previous: "same",
      request: "same",
      updates: ["earlier"],
    });
    const result = advanceSystemPrompt({
      state,
      next: "same",
      modelName: "test-model",
      carriesInHistory: true,
    });

    expect(result.systemMessage).toBe("same");
    expect(state.updates).toEqual(["earlier"]);
    expect(result.warnings).toEqual([]);
  });

  it("appends an update without rewriting the field", () => {
    const state = makeState({ previous: "first", request: "first" });
    const result = advanceSystemPrompt({
      state,
      next: "second",
      modelName: "test-model",
      carriesInHistory: true,
    });

    expect(result.systemMessage).toBe("first");
    expect(state.updates).toEqual(["second"]);
    expect(state.request).toBe("first");
    expect(result.warnings).toEqual([]);
  });

  it("keeps the earlier updates array intact for the remembered header", () => {
    const earlier = ["old"];
    const state = makeState({
      previous: "first",
      request: "first",
      updates: earlier,
    });

    advanceSystemPrompt({
      state,
      next: "second",
      modelName: "test-model",
      carriesInHistory: true,
    });

    expect(earlier).toEqual(["old"]);
  });

  it("rewrites when the dialect cannot carry a second system message", () => {
    const state = makeState({
      previous: "first",
      request: "first",
      updates: ["old"],
    });
    const result = advanceSystemPrompt({
      state,
      next: "second",
      modelName: "test-model",
      carriesInHistory: false,
    });

    expect(result.systemMessage).toBe("second");
    expect(state.updates).toEqual([]);
    expect(state.request).toBe("second");
    expect(result.warnings.join(" ")).toContain("cached tokens rebilled");
  });

  it("still appends when the configuration asked for it, and says so", () => {
    const state = makeState({ previous: "first", request: "first" });
    const result = advanceSystemPrompt({
      state,
      next: "second",
      modelName: "test-model",
      supportsInHistoryUpdate: true,
      carriesInHistory: false,
    });

    expect(state.updates).toEqual(["second"]);
    expect(result.warnings.join(" ")).toContain("not known to carry");
  });

  it("names the section that moved rather than the whole prompt", () => {
    const previous = '<base>\n</base>\n<context name="userRules">old</context>';
    const next = '<base>\n</base>\n<context name="userRules">new</context>';

    const state = makeState({ previous, request: previous, updates: [] });
    const result = advanceSystemPrompt({
      state,
      next,
      modelName: "test-model",
      carriesInHistory: false,
    });

    expect(result.warnings.join(" ")).toContain("userRules rewritten");
  });
});
