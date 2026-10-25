import * as os from "os";

import { describe, expect, it } from "vitest";

import {
  ACCEPT_EDITS_MODE_POLICIES,
  BYPASS_PERMISSIONS_POLICIES,
  PLAN_MODE_POLICIES,
  getDefaultToolPolicies,
} from "./defaultPolicies.js";
import {
  TOOL_NARROWED_ALLOW_NOTICE,
  checkToolPermission,
} from "./permissionChecker.js";
import type { ToolPermissionPolicy } from "./types.js";

const outside = os.tmpdir();

function search(
  args: Record<string, unknown>,
  policies: ToolPermissionPolicy[],
) {
  return checkToolPermission({ name: "Search", arguments: args }, { policies });
}

/**
 * Search reads whatever the pattern matches. The rule that allows the tool
 * speaks for the workspace, so the target path decides whether that rule still
 * answers for the call.
 */
describe("Search stays inside the workspace's allow rule", () => {
  it("allows a search inside the workspace", () => {
    const result = search(
      { pattern: "x", path: "src" },
      getDefaultToolPolicies(),
    );

    expect(result.permission).toBe("allow");
  });

  it("asks for a target outside the workspace", () => {
    const result = search(
      { pattern: "x", path: outside },
      getDefaultToolPolicies(),
    );

    expect(result.permission).toBe("ask");
    expect(result.reason).toBe(TOOL_NARROWED_ALLOW_NOTICE);
  });

  it("asks when the target walks out with ..", () => {
    const result = search(
      { pattern: "x", path: "../.." },
      getDefaultToolPolicies(),
    );

    expect(result.permission).toBe("ask");
  });

  it("treats no path as the workspace", () => {
    const result = search({ pattern: "x" }, getDefaultToolPolicies());

    expect(result.permission).toBe("allow");
  });

  it("asks in plan mode too, where the search is otherwise allowed", () => {
    expect(
      search({ pattern: "x", path: outside }, PLAN_MODE_POLICIES).permission,
    ).toBe("ask");
    expect(
      search({ pattern: "x", path: "src" }, PLAN_MODE_POLICIES).permission,
    ).toBe("allow");
  });

  it("asks in acceptEdits mode too", () => {
    expect(
      search({ pattern: "x", path: outside }, ACCEPT_EDITS_MODE_POLICIES)
        .permission,
    ).toBe("ask");
    expect(
      search({ pattern: "x", path: "src" }, ACCEPT_EDITS_MODE_POLICIES)
        .permission,
    ).toBe("allow");
  });

  it("leaves the bypass override alone", () => {
    expect(
      search({ pattern: "x", path: outside }, BYPASS_PERMISSIONS_POLICIES)
        .permission,
    ).toBe("allow");
  });

  it("keeps the plain read tools unfettered", () => {
    // Read has no target hook, so this change is scoped to the tool that asked
    // for one rather than to every read.
    const result = checkToolPermission(
      { name: "Read", arguments: { filepath: `${outside}/x.ts` } },
      { policies: getDefaultToolPolicies() },
    );

    expect(result.permission).toBe("allow");
  });
});
