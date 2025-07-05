import { describe, expect, it } from "vitest";

import {
  canDelegate,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  delegationDepthOf,
  resolveChildDepth,
  SubagentDepthError,
} from "./depth.js";

describe("delegation depth", () => {
  it("starts a top-level agent at depth zero", () => {
    expect(delegationDepthOf(undefined)).toBe(0);
    expect(delegationDepthOf({}, undefined)).toBe(0);
  });

  it("combines the persisted depth with the runtime depth, taking the larger", () => {
    expect(delegationDepthOf({ delegationDepth: 2 }, 1)).toBe(2);
    expect(delegationDepthOf({ delegationDepth: 1 }, 3)).toBe(3);
  });

  it("does not let a resumed child restart the count", () => {
    // A resumed session reports depth 0 from the runtime, but the header still
    // remembers it was a child.
    expect(delegationDepthOf({ delegationDepth: 1 }, 0)).toBe(1);
  });

  it("allows one level of delegation by default", () => {
    const parent = {
      delegationDepth: 0,
      maxDelegationDepth: DEFAULT_MAX_SUBAGENT_DEPTH,
    };
    expect(canDelegate(parent)).toBe(true);
    expect(resolveChildDepth(parent)).toBe(1);
  });

  it("refuses to delegate past the limit", () => {
    const child = { delegationDepth: 1, maxDelegationDepth: 1 };
    expect(canDelegate(child)).toBe(false);
    expect(() => resolveChildDepth(child)).toThrow(SubagentDepthError);
  });

  it("counts from the persisted depth, not the runtime depth", () => {
    // The runtime thinks it is top-level, but the header says it is a child.
    const context = { delegationDepth: 0, maxDelegationDepth: 1 };
    expect(() => resolveChildDepth(context, { delegationDepth: 1 })).toThrow(
      SubagentDepthError,
    );
  });

  it("allows a raised limit to permit deeper delegation", () => {
    const context = { delegationDepth: 1, maxDelegationDepth: 2 };
    expect(resolveChildDepth(context)).toBe(2);
  });

  it("rejects a depth that is no longer a safe integer", () => {
    const context = {
      delegationDepth: Number.MAX_SAFE_INTEGER,
      maxDelegationDepth: Number.MAX_SAFE_INTEGER,
    };
    expect(() => resolveChildDepth(context)).toThrow(RangeError);
  });
});
