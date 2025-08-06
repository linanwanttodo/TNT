import { describe, expect, it } from "vitest";

import { isDocumentPath } from "./documentPath.js";

describe("isDocumentPath", () => {
  it("should accept documentation extensions in any directory", () => {
    const accepted = [
      "plan.md",
      "docs/design.mdx",
      "NOTES.markdown",
      "docs/notes.txt",
      "docs/spec.rst",
      "/abs/path/readme.MD",
    ];

    for (const filePath of accepted) {
      expect(isDocumentPath(filePath), filePath).toBe(true);
    }
  });

  it("should refuse source files and unknown extensions", () => {
    const refused = [
      "src/index.ts",
      "main.rs",
      "app.py",
      "Dockerfile",
      "package.json",
      "docs/notes.md.bak",
      "scripts/deploy.sh",
      ".hidden",
    ];

    for (const filePath of refused) {
      expect(isDocumentPath(filePath), filePath).toBe(false);
    }
  });

  it("should refuse empty and non-string input", () => {
    expect(isDocumentPath("")).toBe(false);
    expect(isDocumentPath("   ")).toBe(false);
    expect(isDocumentPath(undefined)).toBe(false);
    expect(isDocumentPath(null)).toBe(false);
    expect(isDocumentPath(42)).toBe(false);
  });
});
