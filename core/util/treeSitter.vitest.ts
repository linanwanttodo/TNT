import { describe, expect, it } from "vitest";

import { getLanguageForFile, getSymbolsForFile } from "./treeSitter.js";

describe("tree-sitter ESM asset resolution", () => {
  it("loads the TypeScript grammar and extracts a function symbol", async () => {
    const language = await getLanguageForFile("example.ts");
    expect(language).toBeDefined();

    const symbols = await getSymbolsForFile(
      "example.ts",
      "function greet(name: string) { return `Hello ${name}`; }",
    );

    expect(symbols).toEqual([expect.objectContaining({ name: "greet" })]);
  });
});
