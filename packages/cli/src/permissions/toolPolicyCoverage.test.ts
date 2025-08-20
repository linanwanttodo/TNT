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
 */
describe("tool policy coverage", () => {
  const agent = getDefaultToolPolicies();
  const plan = PLAN_MODE_POLICIES;

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
