import { describe, expect, it } from "vitest";

import { PERMISSION_MODES } from "../permissions/types.js";

import { resolveModeFromFlags } from "./flagProcessor.js";

/**
 * The acceptance line for permission-mode parity: every declared value parses,
 * `auto` is refused until its classifier exists, bypass needs its explicit
 * opt-in, the legacy aliases still resolve, and the TNT environment variable
 * wins over the Claude-compatible one.
 */
describe("--permission-mode parsing and gating", () => {
  it("parses every declared value", () => {
    expect(PERMISSION_MODES).toHaveLength(6);

    for (const value of PERMISSION_MODES) {
      if (value === "auto") {
        expect(() =>
          resolveModeFromFlags({ permissionMode: value, env: {} }),
        ).toThrow(/classifier/);
        continue;
      }
      const resolved = resolveModeFromFlags({
        permissionMode: value,
        dangerouslySkipPermissions: value === "bypassPermissions",
        env: {},
      });
      expect(resolved.mode).toBe(value);
    }
  });

  it("refuses bypass without an explicit opt-in", () => {
    expect(() =>
      resolveModeFromFlags({ permissionMode: "bypassPermissions", env: {} }),
    ).toThrow(/requires --dangerously-skip-permissions/);
    expect(
      resolveModeFromFlags({
        permissionMode: "bypassPermissions",
        dangerouslySkipPermissions: true,
        env: {},
      }).mode,
    ).toBe("bypassPermissions");
    expect(
      resolveModeFromFlags({
        permissionMode: "bypassPermissions",
        env: { TNT_PERMISSION_MODE: "bypassPermissions" },
      }).mode,
    ).toBe("bypassPermissions");
  });

  it("maps the legacy aliases and reports the substitution", () => {
    const agent = resolveModeFromFlags({ mode: "agent", env: {} });
    expect(agent.mode).toBe("default");
    expect(agent.warnings[0]).toMatch(/deprecated/);

    expect(resolveModeFromFlags({ auto: true, env: {} }).mode).toBe(
      "bypassPermissions",
    );
    expect(resolveModeFromFlags({ readonly: true, env: {} }).mode).toBe("plan");
  });

  it("prefers TNT_PERMISSION_MODE over the Claude variable", () => {
    expect(
      resolveModeFromFlags({
        env: {
          TNT_PERMISSION_MODE: "plan",
          CLAUDE_CODE_PERMISSION_MODE: "acceptEdits",
        },
      }).mode,
    ).toBe("plan");
    expect(
      resolveModeFromFlags({
        env: { CLAUDE_CODE_PERMISSION_MODE: "acceptEdits" },
      }).mode,
    ).toBe("acceptEdits");
  });

  it("refuses conflicts and unknown values", () => {
    expect(() =>
      resolveModeFromFlags({ permissionMode: "plan", readonly: true, env: {} }),
    ).toThrow(/cannot be combined/);
    expect(() =>
      resolveModeFromFlags({ permissionMode: "nope", env: {} }),
    ).toThrow(/Invalid --permission-mode/);
    expect(() =>
      resolveModeFromFlags({
        dangerouslySkipPermissions: true,
        mode: "plan",
        env: {},
      }),
    ).toThrow(/cannot be combined/);
  });
});
