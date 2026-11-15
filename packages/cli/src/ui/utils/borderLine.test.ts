import { describe, expect, it } from "vitest";

import { composeTopBorder } from "./borderLine.js";

const buildLine = (width: number, label?: string) => {
  const border = composeTopBorder(width, label);
  return {
    ...border,
    line: border.prefix + border.label + border.suffix,
  };
};

describe("composeTopBorder", () => {
  it("embeds a mode label after the first cell of a rule of the requested width", () => {
    const { line } = buildLine(20, "[plan]");

    expect(line.startsWith("─[plan]")).toBe(true);
    expect(line.endsWith("─")).toBe(true);
    expect(line).toHaveLength(20);
    expect(line.slice("─[plan]".length)).toHaveLength(13);
    expect(line.slice("─[plan]".length).replace(/─/g, "")).toBe("");
  });

  it("produces a plain rule when no label is present", () => {
    const { line } = buildLine(12);

    expect(line).toHaveLength(12);
    expect(line.replace(/─/g, "")).toBe("");
  });

  it("grows the line instead of dropping the label in a tiny terminal", () => {
    const { line, width } = buildLine(4, "[auto]");

    expect(width).toBe(7);
    expect(line).toHaveLength(7);
    expect(line.startsWith("─[auto]")).toBe(true);
  });
});
