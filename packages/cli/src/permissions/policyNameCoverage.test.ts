import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";

import {
  BYPASS_PERMISSIONS_POLICIES,
  PLAN_MODE_POLICIES,
  getDefaultToolPolicies,
} from "./defaultPolicies.js";

/**
 * The permission layer works on names, and the sweep is derived from the tool
 * registry (`ALL_BUILT_IN_TOOLS`), so a new tool is compared against the policy
 * lists without anyone updating a copy of its name. A governed name that is not
 * in the registry can still be offered to the model and never be excluded by a
 * restrictive mode - silently.
 *
 * The allowance is empty; an entry would mean a governed name nobody ships,
 * which the last case refuses to let sit unnoticed.
 */
const SWEEP_BLIND: string[] = [];

function policyNames(): Set<string> {
  const names = new Set<string>();
  for (const policies of [
    getDefaultToolPolicies(),
    PLAN_MODE_POLICIES,
    BYPASS_PERMISSIONS_POLICIES,
  ]) {
    for (const policy of policies) {
      // A `*` rule is a catch-all, not a tool name.
      if (policy.tool !== "*") {
        names.add(policy.tool);
      }
    }
  }
  return names;
}

describe("the names the permission policies govern", () => {
  const governed = policyNames();
  const swept = new Set<string>(ALL_BUILT_IN_TOOLS.map((tool) => tool.name));
  const blind = [...governed].filter(
    (name) => !swept.has(name) && !SWEEP_BLIND.includes(name),
  );

  it("reads policy lists and a sweep list that are both really populated", () => {
    expect(governed.size).toBeGreaterThan(20);
    expect(swept.size).toBeGreaterThan(20);
  });

  it("keeps every governed name inside the sweep, except the debt it names", () => {
    expect(blind).toEqual([]);
  });

  it("lists only names that are still governed and still outside the sweep", () => {
    for (const entry of SWEEP_BLIND) {
      expect(governed.has(entry), entry).toBe(true);
      expect(swept.has(entry), entry).toBe(false);
    }
  });
});
