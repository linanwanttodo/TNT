import { describe, expect, it } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import type { ToolPermissions } from "../permissions/types.js";

import {
  createChildContext,
  narrowPermissions,
  type AgentRunContext,
} from "./runContext.js";

function parent(
  permissions: ToolPermissions,
  overrides: Partial<AgentRunContext> = {},
): AgentRunContext {
  return {
    id: "root",
    parentContext: undefined,
    delegationDepth: 0,
    systemMessage: "base",
    permissions,
    mode: "agent",
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("deniedTools", () => {
  it("excludes a named tool from a child that would otherwise allow it", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "*", permission: "allow" }] },
      { deniedTools: ["AskQuestion", "Exit"] },
    );

    expect(
      checkToolPermission({ name: "AskQuestion", arguments: {} }, result)
        .permission,
    ).toBe("exclude");
    expect(
      checkToolPermission({ name: "Exit", arguments: {} }, result).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission({ name: "Read", arguments: {} }, result).permission,
    ).toBe("allow");
  });

  it("adds to the restriction rather than replacing it", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "*", permission: "allow" }] },
      { restriction: "no-writes", deniedTools: ["AskQuestion"] },
    );

    expect(
      checkToolPermission({ name: "Write", arguments: {} }, result).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission({ name: "AskQuestion", arguments: {} }, result)
        .permission,
    ).toBe("exclude");
    expect(
      checkToolPermission({ name: "Bash", arguments: {} }, result).permission,
    ).toBe("allow");
  });

  it("names the missing tools in the child's prompt", () => {
    const child = createChildContext(
      parent({ policies: [{ tool: "*", permission: "allow" }] }),
      {
        id: "child",
        delegationDepth: 1,
        systemMessage: "base system",
        deniedTools: ["AskQuestion"],
      },
    );

    expect(child.systemMessage).toContain(
      "These tools are not available to you: AskQuestion.",
    );
    expect(
      checkToolPermission(
        { name: "AskQuestion", arguments: {} },
        child.permissions,
      ).permission,
    ).toBe("exclude");
  });
});

describe("narrowPermissions", () => {
  it("keeps an allow as an allow when not readonly", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Read", permission: "allow" }] },
      {},
    );
    expect(result.policies).toEqual([{ tool: "Read", permission: "allow" }]);
  });

  it("separates no file writes from no commands at all", () => {
    const wildcard = {
      policies: [{ tool: "*", permission: "allow" as const }],
    };

    const noWrites = narrowPermissions(wildcard, { restriction: "no-writes" });
    expect(
      checkToolPermission({ name: "Bash", arguments: {} }, noWrites).permission,
    ).toBe("allow");
    expect(
      checkToolPermission({ name: "Write", arguments: {} }, noWrites)
        .permission,
    ).toBe("exclude");

    const readOnly = narrowPermissions(wildcard, { restriction: "readonly" });
    expect(
      checkToolPermission({ name: "Bash", arguments: {} }, readOnly).permission,
    ).toBe("exclude");
  });

  it("downgrades an ask to an exclude, never to an allow", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Read", permission: "ask" }] },
      {},
    );
    expect(result.policies).toEqual([{ tool: "Read", permission: "exclude" }]);
  });

  it("does not let a child widen a tool its parent excluded", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Bash", permission: "exclude" }] },
      {},
    );
    expect(result.policies).toEqual([{ tool: "Bash", permission: "exclude" }]);
  });

  it("excludes mutating tools in readonly mode", () => {
    const result = narrowPermissions(
      {
        policies: [
          { tool: "Read", permission: "allow" },
          { tool: "Write", permission: "allow" },
          { tool: "Bash", permission: "allow" },
        ],
      },
      { restriction: "readonly" },
    );
    expect(result.policies).toContainEqual({
      tool: "Write",
      permission: "exclude",
    });
    expect(result.policies).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
    expect(result.policies).toContainEqual({
      tool: "Read",
      permission: "allow",
    });
  });

  it("expands a wildcard in readonly mode so the exclusions actually bite", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "*", permission: "allow" }] },
      { restriction: "readonly" },
    );

    // Assert the verdict, not the list shape: the checker takes the first
    // matching policy, so a list that merely contains the exclusions can still
    // let a write through.
    for (const tool of ["Write", "Edit", "Bash"]) {
      expect(
        checkToolPermission({ name: tool, arguments: {} }, result).permission,
        tool,
      ).toBe("exclude");
    }
    expect(
      checkToolPermission({ name: "Read", arguments: {} }, result).permission,
    ).not.toBe("exclude");
  });

  it("keeps an excluded wildcard excluded in readonly mode", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "*", permission: "exclude" }] },
      { restriction: "readonly" },
    );
    for (const tool of ["Write", "Read", "Bash"]) {
      expect(
        checkToolPermission({ name: tool, arguments: {} }, result).permission,
        tool,
      ).toBe("exclude");
    }
  });

  it("narrows the child without touching the parent", () => {
    const parentPermissions: ToolPermissions = {
      policies: [
        { tool: "*", permission: "ask" },
        { tool: "Write", permission: "allow" },
      ],
    };
    const snapshot = structuredClone(parentPermissions);
    const writeVerdict = checkToolPermission(
      { name: "Write", arguments: {} },
      parentPermissions,
    ).permission;

    const child = narrowPermissions(parentPermissions, {
      restriction: "readonly",
    });

    // A session that delegates must not come back to find its own policy
    // narrowed: two children of one parent would then inherit each other.
    expect(parentPermissions).toEqual(snapshot);
    expect(
      checkToolPermission({ name: "Write", arguments: {} }, parentPermissions)
        .permission,
    ).toBe(writeVerdict);
    expect(
      checkToolPermission({ name: "Write", arguments: {} }, child).permission,
    ).toBe("exclude");
  });
});

describe("createChildContext", () => {
  it("records the parent link and the child depth", () => {
    const p = parent({ policies: [] });
    const child = createChildContext(p, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "child prompt",
    });
    expect(child.parentContext).toBe(p);
    expect(child.delegationDepth).toBe(1);
    expect(child.systemMessage).toBe("child prompt");
  });

  it("inherits the parent's mode and abort signal by default", () => {
    const p = parent({ policies: [] }, { mode: "plan" });
    const child = createChildContext(p, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "x",
    });
    expect(child.mode).toBe("plan");
    expect(child.abortSignal).toBe(p.abortSignal);
  });

  it("narrows permissions relative to the parent", () => {
    const p = parent({
      policies: [
        { tool: "Read", permission: "allow" },
        { tool: "Bash", permission: "allow" },
      ],
    });
    const child = createChildContext(p, {
      id: "child-1",
      delegationDepth: 1,
      systemMessage: "x",
      restriction: "readonly",
    });
    expect(child.permissions.policies).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
  });

  it("gives two children of the same parent independent contexts", () => {
    const p = parent({ policies: [{ tool: "Read", permission: "allow" }] });
    const a = createChildContext(p, {
      id: "a",
      delegationDepth: 1,
      systemMessage: "a",
    });
    const b = createChildContext(p, {
      id: "b",
      delegationDepth: 1,
      systemMessage: "b",
    });
    expect(a.systemMessage).not.toBe(b.systemMessage);
    expect(a.permissions).not.toBe(b.permissions);
  });
});
