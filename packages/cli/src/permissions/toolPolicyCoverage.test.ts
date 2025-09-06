import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getDefaultToolPolicies,
  PLAN_MODE_POLICIES,
} from "./defaultPolicies.js";
import type { ToolPermissionPolicy } from "./types.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";
import { BUILT_IN_TOOL_NAMES } from "../tools/builtInToolNames.js";
import { getAllAvailableTools } from "../tools/index.js";
import { setBetaSubagentToolEnabled } from "../tools/toolsConfig.js";

function policyFor(
  list: ToolPermissionPolicy[],
  tool: string,
): ToolPermissionPolicy | undefined {
  return list.find((policy) => policy.tool === tool);
}

/**
 * A tool that nobody wrote a policy for is not an error anywhere: it falls back
 * to "ask" in agent mode and is simply unavailable in plan mode, which reads as
 * a broken tool rather than a missing rule. Both lists are therefore checked
 * against the tool registry, so adding a tool without a rule fails here.
 *
 * The other direction is the one that rots silently: a policy that names a tool
 * the model is never offered grants nothing, and reads as a capability the CLI
 * has. That is only acceptable on purpose, so every such name is declared below
 * with the condition that hides it, and the guard fails on a name that is
 * neither offered nor declared.
 */
describe("tool policy coverage", () => {
  const agent = getDefaultToolPolicies();
  const plan = PLAN_MODE_POLICIES;

  /** Names a plain TUI run may or may not be offered, and why. */
  const CONDITIONALLY_OFFERED: Record<string, string> = {
    Exit: "only a headless run is told to exit",
    Search: "needs ripgrep on the machine",
    Status: "posts to the platform for an agent, which --id names",
    ReportFailure: "reports to the platform for an agent, which --id names",
    UploadArtifact: "needs --id and the beta flag",
    Subagent: "needs the beta flag and a run below the depth limit",
    ListSubagents: "needs the beta flag and a run below the depth limit",
  };

  /** Withheld in every mode of this test's flags, so its absence is checkable. */
  const NEVER_OFFERED_HERE = [
    "Exit",
    "ReportFailure",
    "UploadArtifact",
    "Status",
  ];

  describe("the tools a run is actually offered", () => {
    beforeEach(() => {
      // The dynamic tools are the ones the static lists cannot see: a beta
      // gated tool is only built when its flag is on.
      setBetaSubagentToolEnabled(true);
      serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
        model: { name: "test-model" },
      } as never);
      serviceContainer.registerValue(SERVICE_NAMES.MCP, { tools: [] } as never);
    });

    afterEach(() => {
      setBetaSubagentToolEnabled(false);
    });

    it("gives every one of them a policy in both modes", async () => {
      const offered = await getAllAvailableTools(false, true);
      const uncovered = offered
        .filter(
          (tool) => !policyFor(agent, tool.name) || !policyFor(plan, tool.name),
        )
        .map((tool) => tool.name);

      expect(offered.length).toBeGreaterThan(10);
      expect(uncovered).toEqual([]);
    });

    it("accounts for every tool the policies name", async () => {
      const offered = new Set(
        (await getAllAvailableTools(false, true)).map((tool) => tool.name),
      );
      const named = new Set(
        [...agent, ...plan]
          .map((policy) => policy.tool)
          .filter((name) => name !== "*"),
      );
      const unaccounted = [...named].filter(
        (name) => !offered.has(name) && !CONDITIONALLY_OFFERED[name],
      );

      expect(unaccounted).toEqual([]);
    });

    it("keeps every stated reason a reason and every declared name a tool", async () => {
      const offered = new Set(
        (await getAllAvailableTools(false, true)).map((tool) => tool.name),
      );
      // A declared condition that has stopped holding would hide the fact that
      // the tool is now always offered, so the ones this run cannot enable are
      // checked to be actually absent.
      for (const name of NEVER_OFFERED_HERE) {
        expect(
          offered.has(name),
          `${name}: ${CONDITIONALLY_OFFERED[name]}`,
        ).toBe(false);
      }
      const stale = Object.keys(CONDITIONALLY_OFFERED).filter(
        (name) => !(BUILT_IN_TOOL_NAMES as readonly string[]).includes(name),
      );
      expect(stale).toEqual([]);
    });

    it("drops the delegation tools once a run has reached its depth limit", async () => {
      const mayDelegate = (await getAllAvailableTools(false, true)).map(
        (tool) => tool.name,
      );
      const cannotDelegate = (await getAllAvailableTools(false, false)).map(
        (tool) => tool.name,
      );

      expect(mayDelegate).toContain("Subagent");
      expect(mayDelegate).toContain("ListSubagents");
      expect(cannotDelegate).not.toContain("Subagent");
      expect(cannotDelegate).not.toContain("ListSubagents");
      // Only those two disappear; everything else is untouched.
      expect(cannotDelegate).toContain("Read");
      expect(cannotDelegate.length).toBe(mayDelegate.length - 2);
    });
  });

  it("gives every built-in tool a policy in agent mode", () => {
    const uncovered = BUILT_IN_TOOL_NAMES.filter(
      (name) => !policyFor(agent, name),
    );

    expect(uncovered).toEqual([]);
  });

  it("gives every built-in tool a policy in plan mode", () => {
    const uncovered = BUILT_IN_TOOL_NAMES.filter(
      (name) => !policyFor(plan, name),
    );

    expect(uncovered).toEqual([]);
  });

  it("allows every read-only tool in both modes", () => {
    const readOnly = ALL_BUILT_IN_TOOLS.filter((tool) => tool.readonly).map(
      (tool) => tool.name,
    );
    expect(readOnly.length).toBeGreaterThan(10);

    for (const name of readOnly) {
      expect(policyFor(agent, name)?.permission, `agent ${name}`).toBe("allow");
      expect(policyFor(plan, name)?.permission, `plan ${name}`).toBe("allow");
    }
  });

  it("keeps the write tools out of plan mode's reach", () => {
    for (const name of ["Edit", "MultiEdit", "Write"]) {
      const policy = policyFor(plan, name);
      expect(policy, name).toBeDefined();
      // Plan mode may write documentation, so these are scoped rather than
      // refused; the scope itself is enforced at call time.
      expect(policy?.docsOnly, name).toBe(true);
    }
  });
});
