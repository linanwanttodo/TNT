import { describe, expect, it } from "vitest";

import { ToolPermissionService } from "../services/ToolPermissionService.js";

import {
  ACCEPT_EDITS_MODE_POLICIES,
  getDefaultToolPolicies,
} from "./defaultPolicies.js";
import { checkToolPermission } from "./permissionChecker.js";

const accept = { policies: ACCEPT_EDITS_MODE_POLICIES };
const defaults = { policies: getDefaultToolPolicies() };

describe("acceptEdits and the default Bash rule", () => {
  it("allows the four write tools inside the workspace", () => {
    for (const name of ["Write", "Edit", "MultiEdit", "ApplyPatch"]) {
      expect(
        checkToolPermission(
          { name, arguments: { filepath: "src/a.ts", content: "x" } },
          accept,
        ).permission,
        name,
      ).toBe("allow");
    }
    const policy = ACCEPT_EDITS_MODE_POLICIES.find((p) => p.tool === "Write");
    expect(policy?.workspaceOnly).toBe(true);
  });

  it("lets read-only Bash run and asks for a writing command", () => {
    for (const permissions of [defaults, accept]) {
      expect(
        checkToolPermission(
          { name: "Bash", arguments: { command: "git status" } },
          permissions,
        ).permission,
      ).toBe("allow");
      expect(
        checkToolPermission(
          { name: "Bash", arguments: { command: "git commit -m x" } },
          permissions,
        ).permission,
      ).toBe("ask");
    }
  });

  it("still asks for MCP and plugin tools", () => {
    expect(
      checkToolPermission(
        { name: "mcp__github__create", arguments: {} },
        accept,
      ).permission,
    ).toBe("ask");
  });

  it("replaces the layers when the service starts in acceptEdits", () => {
    const service = new ToolPermissionService();
    const state = service.initializeSync({
      mode: "acceptEdits",
      allow: ["Read"],
    });

    expect(state.currentMode).toBe("acceptEdits");
    expect(state.permissions.policies).toEqual(ACCEPT_EDITS_MODE_POLICIES);
  });
});
