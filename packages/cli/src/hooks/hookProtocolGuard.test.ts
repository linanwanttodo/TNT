import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { HookFixtures } from "../../test-utils/hookFixtures.js";

import { logger } from "../utils/logger.js";

import { runHooks } from "./hookRunner.js";
import type { HookHandler, HooksConfig, HookInput } from "./types.js";

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hook-guard-"));
const fixtures = new HookFixtures(workDir);

afterAll(() => {
  fs.rmSync(workDir, {
    recursive: true,
    force: true,
    maxRetries: 40,
    retryDelay: 250,
  });
});

const echo = (json: string) => fixtures.echo(json);

function event(
  hookEventName: string,
  extra: Record<string, unknown> = {},
): HookInput {
  return {
    hook_event_name: hookEventName,
    session_id: "sess-1",
    transcript_path: "/tmp/t.jsonl",
    cwd: process.cwd(),
    ...extra,
  } as HookInput;
}

function configFor(eventName: string, ...command: string[]): HooksConfig {
  const handlers: HookHandler[] = command.map((cmd) => ({
    type: "command",
    command: cmd,
  }));
  return {
    [eventName]: [{ matcher: "*", hooks: handlers }],
  } as HooksConfig;
}

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * The hook output protocol is whatever a hook's stdout happens to parse to, so
 * the aggregator has to defend itself: an output that names another event is
 * not read as this event's fields, and a PermissionRequest decision that is
 * not the promised shape is skipped instead of dereferenced.
 */
describe("hook output protocol guard", () => {
  it("ignores event-specific fields an output names for another event, keeping the context", async () => {
    const result = await runHooks(
      configFor(
        "PreToolUse",
        echo(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: "still applies",
            },
          }),
        ),
        echo(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: "legit",
              updatedInput: { command: "rewritten" },
            },
          }),
        ),
      ),
      event("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
    );

    // The mismatched output's fields are not read for this event...
    expect(result.additionalContext).toContain("still applies");
    // ...while the correctly-named one still decides.
    expect(result.permissionDecision).toBe("deny");
    expect(result.updatedInput).toEqual({ command: "rewritten" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("UserPromptSubmit"),
      expect.objectContaining({ hook: expect.stringContaining("command:") }),
    );
  });

  it("does not apply PreToolUse-shaped fields to a PermissionRequest event", async () => {
    const result = await runHooks(
      configFor(
        "PermissionRequest",
        echo(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              updatedInput: { tool_input: "nope" },
            },
          }),
        ),
      ),
      event("PermissionRequest", {
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }),
    );

    expect(result.permissionRequestDecision).toBeUndefined();
    expect(result.blocked).toBe(false);
    expect(result.updatedInput).toBeUndefined();
  });

  it("skips a PermissionRequest decision that is missing or not an object", async () => {
    const result = await runHooks(
      configFor(
        "PermissionRequest",
        echo(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: "PermissionRequest" },
          }),
        ),
        echo(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PermissionRequest",
              decision: "allow",
            },
          }),
        ),
      ),
      event("PermissionRequest", {
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }),
    );

    expect(result.permissionRequestDecision).toBeUndefined();
    expect(result.blocked).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no usable decision"),
      expect.anything(),
    );
  });

  it("still honors a well-formed PermissionRequest decision", async () => {
    const result = await runHooks(
      configFor(
        "PermissionRequest",
        echo(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PermissionRequest",
              decision: { behavior: "deny", message: "not on my machine" },
            },
          }),
        ),
      ),
      event("PermissionRequest", {
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }),
    );

    expect(result.permissionRequestDecision).toEqual({
      behavior: "deny",
      message: "not on my machine",
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("not on my machine");
  });
});
