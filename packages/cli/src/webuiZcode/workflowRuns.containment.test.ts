import { describe, expect, it } from "vitest";

import { belongsToWorkspace } from "./services/workflowRuns.js";

/**
 * The workflow tab used to filter sessions by exact workspace string, which
 * hid team runs from sessions opened in a subdirectory of the served project.
 * These cases pin containment without admitting a sibling whose name merely
 * starts with the root's spelling.
 */
describe("a session's workspace belongs to the served root", () => {
  it("includes the root itself and directories underneath it", () => {
    expect(belongsToWorkspace("/ws", "/ws")).toBe(true);
    expect(belongsToWorkspace("/ws/packages/cli", "/ws")).toBe(true);
    expect(belongsToWorkspace("/ws/", "/ws")).toBe(true);
  });

  it("excludes siblings, parents and unrelated roots", () => {
    expect(belongsToWorkspace("/ws-other", "/ws")).toBe(false);
    expect(belongsToWorkspace("/home/other", "/ws")).toBe(false);
    expect(belongsToWorkspace("", "/ws")).toBe(false);
  });

  it("accepts every session when the caller names no workspace", () => {
    expect(belongsToWorkspace("/anywhere", undefined)).toBe(true);
    expect(belongsToWorkspace("", undefined)).toBe(true);
  });
});
