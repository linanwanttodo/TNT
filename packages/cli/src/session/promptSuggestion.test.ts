import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPromptSuggestion,
  getPromptSuggestion,
  markPromptSuggestionShown,
  setPromptSuggestion,
} from "./promptSuggestion.js";
import { filterSuggestion } from "./promptSuggestionGenerator.js";

describe("promptSuggestion store", () => {
  beforeEach(() => {
    clearPromptSuggestion();
  });

  afterEach(() => {
    clearPromptSuggestion();
  });

  it("stores a suggestion and reports it", () => {
    setPromptSuggestion("run the tests");
    expect(getPromptSuggestion()?.text).toBe("run the tests");
  });

  it("ignores blank suggestions", () => {
    setPromptSuggestion("   ");
    expect(getPromptSuggestion()).toBeNull();
  });

  it("marks shown only once", () => {
    setPromptSuggestion("commit");
    markPromptSuggestionShown();
    const shownAt = getPromptSuggestion()!.shownAt;
    expect(shownAt).toBeGreaterThan(0);
    markPromptSuggestionShown();
    expect(getPromptSuggestion()!.shownAt).toBe(shownAt);
  });

  it("clearing removes the suggestion", () => {
    setPromptSuggestion("push");
    clearPromptSuggestion();
    expect(getPromptSuggestion()).toBeNull();
  });
});

describe("filterSuggestion", () => {
  it("keeps a short plain answer", () => {
    expect(filterSuggestion("run the tests now")).toBe("run the tests now");
  });

  it("strips wrapping quotes", () => {
    expect(filterSuggestion('"commit and push"')).toBe("commit and push");
  });

  it("drops meta-text about suggesting", () => {
    expect(filterSuggestion("no suggestion")).toBe("");
    expect(filterSuggestion("(silence)")).toBe("");
    expect(filterSuggestion("Nothing")).toBe("");
  });

  it("drops multi-line and overlong answers", () => {
    expect(filterSuggestion("line one\nline two")).toBe("");
    expect(filterSuggestion("a".repeat(120))).toBe("");
  });
});
