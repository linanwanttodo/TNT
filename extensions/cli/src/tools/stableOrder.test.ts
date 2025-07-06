import { describe, expect, it } from "vitest";

import { sortToolsByName, toolListsEqual } from "./stableOrder.js";
import type { Tool } from "./types.js";

function tool(name: string): Tool {
  return {
    name,
    displayName: name,
    description: "",
    parameters: { type: "object", properties: {} },
    readonly: true,
    isBuiltIn: true,
    run: async () => "",
  };
}

describe("sortToolsByName", () => {
  it("orders tools by name", () => {
    const sorted = sortToolsByName([tool("Write"), tool("Edit"), tool("Read")]);
    expect(sorted.map((t) => t.name)).toEqual(["Edit", "Read", "Write"]);
  });

  it("produces the same order regardless of input order", () => {
    const a = sortToolsByName([tool("Read"), tool("Bash"), tool("Edit")]);
    const b = sortToolsByName([tool("Edit"), tool("Read"), tool("Bash")]);
    expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
  });

  it("orders by code unit rather than by locale", () => {
    // A locale-aware comparison would place these differently on a machine
    // configured with another locale, which would break prefix reuse between
    // machines.
    const names = ["_x", "Zeta", "alpha", "Beta"];
    const sorted = sortToolsByName(names.map(tool)).map((t) => t.name);
    expect(sorted).toEqual([...names].sort());
  });

  it("is stable across repeated calls", () => {
    const input = [tool("Search"), tool("List"), tool("Fetch")];
    const first = sortToolsByName(input).map((t) => t.name);
    const second = sortToolsByName(sortToolsByName(input)).map((t) => t.name);
    expect(first).toEqual(second);
  });

  it("does not mutate the input", () => {
    const input = [tool("Write"), tool("Edit")];
    sortToolsByName(input);
    expect(input.map((t) => t.name)).toEqual(["Write", "Edit"]);
  });
});

describe("toolListsEqual", () => {
  it("is true for identical lists in the same order", () => {
    expect(toolListsEqual([tool("a"), tool("b")], [tool("a"), tool("b")])).toBe(
      true,
    );
  });

  it("is false for the same tools in a different order", () => {
    expect(toolListsEqual([tool("a"), tool("b")], [tool("b"), tool("a")])).toBe(
      false,
    );
  });

  it("is false for different lengths", () => {
    expect(toolListsEqual([tool("a")], [tool("a"), tool("b")])).toBe(false);
  });
});
