import { describe, expect, it } from "vitest";

import { BUILT_IN_TOOL_NAMES } from "../tools/builtInToolNames.js";

import {
  AUTO_MODE_POLICIES,
  PLAN_MODE_POLICIES,
  getDefaultToolPolicies,
} from "./defaultPolicies.js";

/**
 * The permission layer works on names, and two of its lists are maintained by
 * hand: the default policies, and the built-in name list the default-deny sweep
 * reads (`ToolPermissionService` excludes every name on it that a mode does not
 * mention). A tool governed by a policy but absent from that list can be offered
 * to the model and still never be excluded by a restrictive mode - silently.
 *
 * Names below that list are the measured, deliberate debt: an entry leaves it
 * only by being added to the sweep's list, which the last case refuses to let
 * happen unnoticed.
 */
const SWEEP_BLIND: string[] = [
  "CheckBackgroundJob",
  "EnterPlanMode",
  "ExitPlanMode",
  "Glob",
];

function policyNames(): Set<string> {
  const names = new Set<string>();
  for (const policies of [
    getDefaultToolPolicies(false),
    getDefaultToolPolicies(true),
    PLAN_MODE_POLICIES,
    AUTO_MODE_POLICIES,
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
  const swept = new Set<string>(BUILT_IN_TOOL_NAMES);
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
