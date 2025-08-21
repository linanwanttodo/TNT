import { describe, expect, it } from "vitest";

import { ToolPermissionService } from "./ToolPermissionService.js";

/**
 * When an agent file names the tools it may use, everything else is excluded.
 * The exclusion list is built from the built-in tool names, so a tool that was
 * built at runtime and registered nowhere would escape the user's allowlist and
 * stay allowed through the catch-all rule at the end.
 */
function policiesFrom(
  declared: string[],
): { tool: string; permission: string }[] {
  const service = new ToolPermissionService();
  return service.generateAgentFilePolicies({
    parsedTools: {
      tools: declared.map((toolName) => ({ toolName })),
      mcpServers: [],
      allBuiltIn: false,
    },
  } as never);
}

describe("an agent file that names its tools", () => {
  it("allows the named tool", () => {
    const policies = policiesFrom(["Read"]);

    expect(policies).toContainEqual({ tool: "Read", permission: "allow" });
  });

  it("excludes the built-ins it did not name", () => {
    const policies = policiesFrom(["Read"]);

    expect(policies).toContainEqual({ tool: "Write", permission: "exclude" });
    expect(policies).toContainEqual({ tool: "Bash", permission: "exclude" });
  });

  it("excludes the delegation tools too, which are only built at runtime", () => {
    const policies = policiesFrom(["Read"]);

    expect(policies).toContainEqual({
      tool: "Subagent",
      permission: "exclude",
    });
    expect(policies).toContainEqual({
      tool: "ListSubagents",
      permission: "exclude",
    });
  });

  it("keeps the catch-all last so the exclusions win", () => {
    const policies = policiesFrom(["Read"]);
    const wildcardIndex = policies.findIndex((policy) => policy.tool === "*");
    const exclusionIndex = policies.findIndex(
      (policy) => policy.tool === "Write",
    );

    expect(wildcardIndex).toBe(policies.length - 1);
    expect(exclusionIndex).toBeLessThan(wildcardIndex);
  });
});
