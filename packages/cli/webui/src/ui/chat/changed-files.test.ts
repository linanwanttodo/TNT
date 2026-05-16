import { describe, expect, it } from "vitest";

import { toolArguments } from "./changedFiles.js";

describe("toolArguments", () => {
  it("returns a trimmed command for Bash", () => {
    expect(toolArguments("Bash", { command: "  git status  " })).toBe(
      "git status",
    );
  });

  it("truncates long arguments", () => {
    const text = toolArguments("Bash", { command: "x".repeat(80) });
    expect(text).toHaveLength(75);
    expect(text?.endsWith("...")).toBe(true);
  });

  it("returns undefined for unknown tools", () => {
    expect(toolArguments("Something", { anything: "here" })).toBeUndefined();
  });
});
