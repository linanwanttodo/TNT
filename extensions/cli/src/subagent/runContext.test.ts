import { describe, expect, it } from "vitest";

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
    mode: "normal",
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("narrowPermissions", () => {
  it("keeps an allow as an allow when not readonly", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Read", permission: "allow" }] },
      { readonly: false },
    );
    expect(result.policies).toEqual([{ tool: "Read", permission: "allow" }]);
  });

  it("downgrades an ask to an exclude, never to an allow", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Read", permission: "ask" }] },
      { readonly: false },
    );
    expect(result.policies).toEqual([{ tool: "Read", permission: "exclude" }]);
  });

  it("does not let a child widen a tool its parent excluded", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "Bash", permission: "exclude" }] },
      { readonly: false },
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
      { readonly: true },
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
      { readonly: true },
    );
    expect(result.policies).toContainEqual({
      tool: "Write",
      permission: "exclude",
    });
    expect(result.policies).toContainEqual({
      tool: "Edit",
      permission: "exclude",
    });
    expect(result.policies).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
  });

  it("keeps an excluded wildcard excluded in readonly mode", () => {
    const result = narrowPermissions(
      { policies: [{ tool: "*", permission: "exclude" }] },
      { readonly: true },
    );
    expect(result.policies[0]).toEqual({ tool: "*", permission: "exclude" });
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
      readonly: true,
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
