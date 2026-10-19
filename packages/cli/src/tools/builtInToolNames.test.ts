import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { BUILT_IN_TOOL_NAMES } from "./builtInToolNames.js";

/**
 * `BUILT_IN_TOOL_NAMES` is a hand-maintained copy of the registry, kept separate
 * because `ToolPermissionService` cannot import the registry without a circular
 * dependency. The copy is load-bearing in the least forgiving way: the permission
 * service turns every name on it that a mode does not mention into an `exclude`
 * policy. So a tool added to the registry and forgotten here is not merely
 * mislabelled - it falls outside the default-deny sweep and is reachable without a
 * rule saying so.
 *
 * The two directions are different failures, so they are asserted separately:
 * a registry tool missing from the list is a permission hole, a list entry with no
 * tool behind it is dead governance.
 */
describe("the built-in name list the permission sweep reads", () => {
  const registry: string[] = ALL_BUILT_IN_TOOLS.map((tool) => tool.name);
  // The list is declared as a literal tuple so the permission types can narrow on
  // it, which makes it a union rather than a string array - compare through sets.
  const listed: string[] = [...BUILT_IN_TOOL_NAMES];
  const registrySet = new Set(registry);
  const listedSet = new Set(listed);

  it("reads a registry and a list that are both really populated", () => {
    expect(registry.length).toBeGreaterThanOrEqual(20);
    expect(listed.length).toBeGreaterThanOrEqual(20);
    expect(listedSet.size).toBe(listed.length);
  });

  it("lists every tool the registry ships", () => {
    expect(registry.filter((name) => !listedSet.has(name))).toEqual([]);
  });

  it("names no tool the registry does not ship", () => {
    expect(listed.filter((name) => !registrySet.has(name))).toEqual([]);
  });
});
