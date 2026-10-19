import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";

/**
 * The architecture note says the model reaches a language server through four
 * read-only tools and that rename is not one of them. That is a claim about the
 * shipped tool surface, and a rename or a removal would leave the sentence
 * standing while the agent lost the capability - so it is checked against the
 * registry the request is built from, not against a text search of `src/tools`,
 * which also returns names that only appear inside test fixtures.
 *
 * What this does not decide: whether the four behave read-only. That is each
 * tool's own suite.
 */
const READ_ONLY_LSP_TOOLS = [
  "Diagnostics",
  "FindSymbol",
  "Hover",
  "Completion",
];

describe("the tool surface the notes describe", () => {
  const names = ALL_BUILT_IN_TOOLS.map((tool) => tool.name);

  it("reads a registry that is really populated", () => {
    // A broken import would hand back an empty list, and every assertion below
    // would pass on nothing.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers the four language-server tools the note names", () => {
    for (const tool of READ_ONLY_LSP_TOOLS) {
      expect(names, tool).toContain(tool);
    }
  });

  it("still leaves rename unexposed, as the note states", () => {
    expect(names).not.toContain("Rename");
  });
});
