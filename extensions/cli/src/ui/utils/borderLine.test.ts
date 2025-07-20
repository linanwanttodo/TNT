import { describe, expect, it } from "vitest";

import { composeTopBorder } from "./borderLine.js";

const render = (width: number, label?: string) => {
  const border = composeTopBorder(width, label);
  return {
    ...border,
    line: border.prefix + border.label + border.suffix,
  };
};

describe("composeTopBorder", () => {
  it("embeds a mode label at the top-left of a border of the requested width", () => {
    const { line } = render(20, "[plan]");

    expect(line.startsWith("╭─[plan]")).toBe(true);
    expect(line.endsWith("╮")).toBe(true);
    expect(line).toHaveLength(20);
    expect(line.slice("╭─[plan]".length, -1)).toHaveLength(11);
  });

  it("produces a plain rounded top edge when no label is present", () => {
    const { line } = render(12);
    const inner = line.slice(1, -1);

    expect(line.startsWith("╭")).toBe(true);
    expect(line.endsWith("╮")).toBe(true);
    expect(line).toHaveLength(12);
    expect(inner).toHaveLength(10);
    expect(inner.replace(/─/g, "")).toBe("");
  });

  it("grows the line instead of dropping the label in a tiny terminal", () => {
    const { line, width } = render(4, "[auto]");

    expect(width).toBe(10);
    expect(line).toHaveLength(10);
    expect(line.startsWith("╭─[auto]")).toBe(true);
    expect(line.endsWith("╮")).toBe(true);
  });
});
