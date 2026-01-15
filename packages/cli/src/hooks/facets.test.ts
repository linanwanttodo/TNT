import { describe, expect, it } from "vitest";

import { facetsForHookEvent, HOOK_EVENT_FACETS } from "./facets.js";
import { HOOK_EVENT_NAMES } from "./types.js";

describe("hook facets", () => {
  it("names at least one facet for every event", () => {
    for (const event of HOOK_EVENT_NAMES) {
      expect(HOOK_EVENT_FACETS[event].length).toBeGreaterThan(0);
    }
  });

  it("keeps the guard on the events that can block a tool", () => {
    expect(facetsForHookEvent("PreToolUse")).toContain("guard");
    expect(facetsForHookEvent("PermissionRequest")).toContain("guard");
  });

  it("routes prompt context through the prompt facet", () => {
    expect(facetsForHookEvent("UserPromptSubmit")).toContain("prompt");
    expect(facetsForHookEvent("SessionStart")).toContain("prompt");
  });
});
