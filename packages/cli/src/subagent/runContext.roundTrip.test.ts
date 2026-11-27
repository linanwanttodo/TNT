import { describe, expect, it } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import type { ToolCallRequest, ToolPermissions } from "../permissions/types.js";

import { createChildContext } from "./runContext.js";
import type { AgentRunContext } from "./runContext.js";

/** The shape agent mode runs with: everything allowed, nothing pre-excluded. */
function agentPermissions(): ToolPermissions {
  return { policies: [{ tool: "*", permission: "allow" }] };
}

function parentContext(): AgentRunContext {
  return {
    id: "parent-1",
    parentContext: undefined,
    delegationDepth: 0,
    systemMessage: "You are the parent agent.",
    permissions: agentPermissions(),
    mode: "default",
    abortSignal: new AbortController().signal,
    advertise: {
      permissions: agentPermissions(),
      isHeadless: false,
      mode: "default",
    },
  };
}

function call(name: string, args: Record<string, any> = {}): ToolCallRequest {
  return { name, arguments: args };
}

const WRITES = [
  call("Write", { filepath: "src/index.ts", content: "x" }),
  call("Edit", { file_path: "src/index.ts", old_string: "a", new_string: "b" }),
  call("MultiEdit", { file_path: "src/index.ts" }),
  call("Bash", { command: "rm -rf build" }),
  call("UploadArtifact", { filename: "a.png" }),
  call("Checklist", {}),
];

const READS = [
  call("Read", { filepath: "src/index.ts" }),
  call("Search", { query: "needle" }),
  call("List", { path: "." }),
];

describe("a delegated read-only session", () => {
  it("refuses every write and command while it is active", () => {
    const child = createChildContext(parentContext(), {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "You are a delegate.",
      restriction: "readonly",
    });

    for (const request of WRITES) {
      const verdict = checkToolPermission(request, child.permissions);
      expect(verdict.permission, request.name).toBe("exclude");
    }
  });

  it("keeps the read-only tools available", () => {
    const child = createChildContext(parentContext(), {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "You are a delegate.",
      restriction: "readonly",
    });

    for (const request of READS) {
      const verdict = checkToolPermission(request, child.permissions);
      expect(verdict.permission, request.name).not.toBe("exclude");
    }
  });

  it("leaves the parent able to write once the child is done", () => {
    const parent = parentContext();
    const before = JSON.stringify(parent.permissions);

    createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "You are a delegate.",
      restriction: "readonly",
    });

    expect(JSON.stringify(parent.permissions)).toBe(before);
    for (const request of WRITES) {
      const verdict = checkToolPermission(request, parent.permissions);
      expect(verdict.permission, request.name).toBe("allow");
    }
  });

  it("does not let one delegation affect a sibling delegation", () => {
    const parent = parentContext();
    const first = createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "First delegate.",
      restriction: "readonly",
    });
    const second = createChildContext(parent, {
      id: "child-2",
      delegationDepth: 1,
      systemMessage: "Second delegate.",
    });

    expect(checkToolPermission(WRITES[0], first.permissions).permission).toBe(
      "exclude",
    );
    expect(checkToolPermission(WRITES[0], second.permissions).permission).toBe(
      "allow",
    );
    expect(checkToolPermission(WRITES[0], parent.permissions).permission).toBe(
      "allow",
    );
  });

  it("applies a denied tool glob over an explicit parent allow", () => {
    const parent: AgentRunContext = {
      ...parentContext(),
      permissions: {
        policies: [
          { tool: "mcp__broker__place_order", permission: "allow" },
          { tool: "WebSearch", permission: "allow" },
        ],
      },
    };
    const child = createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "Research only.",
      deniedTools: ["mcp__*"],
    });

    expect(
      checkToolPermission(call("mcp__broker__place_order"), child.permissions)
        .permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(call("WebSearch"), child.permissions).permission,
    ).toBe("allow");
  });

  it("applies a markdown tool allowlist and keeps messaging available", () => {
    const child = createChildContext(parentContext(), {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "Research only.",
      allowedTools: ["Read", "WebSearch"],
    });

    expect(
      checkToolPermission(call("Read"), child.permissions).permission,
    ).toBe("allow");
    expect(
      checkToolPermission(call("WebSearch"), child.permissions).permission,
    ).toBe("allow");
    expect(
      checkToolPermission(call("SendMessage"), child.permissions).permission,
    ).toBe("allow");
    expect(
      checkToolPermission(call("Write"), child.permissions).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(call("Bash", { command: "pwd" }), child.permissions)
        .permission,
    ).toBe("exclude");
  });

  it("honors an agent permission mode without changing the parent", () => {
    const parent = parentContext();
    const child = createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "Plan only.",
      permissionMode: "plan",
    });

    expect(child.mode).toBe("plan");
    expect(parent.mode).toBe("default");
    expect(
      checkToolPermission(call("Write"), child.permissions).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(call("Read"), child.permissions).permission,
    ).toBe("allow");
  });

  it("carries the runtime realm into the child context", () => {
    const parent = { ...parentContext(), realmId: 4 };
    const child = createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "Child",
      realmId: 9,
    });

    expect(child.realmId).toBe(9);
    expect(parent.realmId).toBe(4);
  });

  it("cannot widen its own policy from inside the session", () => {
    const child = createChildContext(parentContext(), {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "You are a delegate.",
      restriction: "readonly",
    });

    expect(
      child.permissions.policies.some((policy) => policy.permission === "ask"),
    ).toBe(false);
  });

  it("narrows a plan-mode parent further rather than replacing its rules", () => {
    const parent: AgentRunContext = {
      ...parentContext(),
      mode: "plan",
      permissions: {
        policies: [
          { tool: "*", permission: "allow" },
          { tool: "Write", permission: "allow", docsOnly: true },
        ],
      },
    };

    const child = createChildContext(parent, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "You are a delegate.",
      restriction: "readonly",
    });

    const markdown = call("Write", { filepath: "docs/plan.md" });
    expect(checkToolPermission(markdown, parent.permissions).permission).toBe(
      "allow",
    );
    expect(checkToolPermission(markdown, child.permissions).permission).toBe(
      "exclude",
    );
  });
});
