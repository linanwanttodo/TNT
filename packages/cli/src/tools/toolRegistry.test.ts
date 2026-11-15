import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { BUILT_IN_TOOL_NAMES } from "./builtInToolNames.js";

/**
 * The names list is kept separate from the tool objects to avoid a circular
 * import, which means the two can drift: a tool added to one list and not the
 * other either never runs or never appears to the model.
 */
describe("built-in tool registries", () => {
  it("lists the same tools in both places", () => {
    const declared = [...BUILT_IN_TOOL_NAMES].sort();
    const implemented = ALL_BUILT_IN_TOOLS.map((tool) => tool.name).sort();

    expect(implemented).toEqual(declared);
  });

  it("gives every tool a description and a parameters schema", () => {
    for (const tool of ALL_BUILT_IN_TOOLS) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.parameters?.type, tool.name).toBe("object");
    }
  });
});
