/**
 * Verifies that each fire* helper builds the right Claude Code input and
 * routes it through the hook service, and that hook failures never break the
 * caller.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/index.js", () => {
  const fireEvent = vi.fn(async () => ({ blocked: false, results: [] }));
  return {
    fireEvent,
    services: {
      hooks: {
        isReady: () => true,
        fireEvent,
      },
      toolPermissions: {
        isReady: () => true,
        getState: () => ({ currentMode: "agent" }),
      },
    },
    serviceContainer: { get: vi.fn(async () => ({})) },
  };
});

vi.mock("../session.js", () => ({
  getCurrentSession: () => ({ sessionId: "sess-1", history: [] }),
}));

import { services } from "../services/index.js";
import {
  fireConfigChange,
  firePermissionRequest,
  firePostToolUse,
  firePostToolUseFailure,
  firePreCompact,
  firePreToolUse,
  fireSessionEnd,
  fireSessionStart,
  fireStop,
  fireSubagentStart,
  fireSubagentStop,
  fireUserPromptSubmit,
} from "./fireHook.js";

const NOOP = { blocked: false, results: [] };
const fireEvent = (services.hooks as any).fireEvent as ReturnType<typeof vi.fn>;

describe("fireHook integration points", () => {
  beforeEach(() => {
    fireEvent.mockClear();
    fireEvent.mockResolvedValue(NOOP);
  });

  it("fires PreToolUse with the tool name and input", async () => {
    await firePreToolUse("Bash", { command: "ls" }, "tool-1");

    expect(fireEvent).toHaveBeenCalledTimes(1);
    const input = fireEvent.mock.calls[0][0];
    expect(input.hook_event_name).toBe("PreToolUse");
    expect(input.tool_name).toBe("Bash");
    expect(input.tool_input).toEqual({ command: "ls" });
    expect(input.tool_use_id).toBe("tool-1");
    expect(input.session_id).toBe("sess-1");
    expect(input.permission_mode).toBe("agent");
  });

  it("fires PostToolUse with the tool response", async () => {
    await firePostToolUse("Read", { path: "a" }, "contents", "tool-2");

    const input = fireEvent.mock.calls[0][0];
    expect(input.hook_event_name).toBe("PostToolUse");
    expect(input.tool_response).toBe("contents");
  });

  it("fires PostToolUseFailure with the error", async () => {
    await firePostToolUseFailure("Bash", {}, "tool-3", "boom", true);

    const input = fireEvent.mock.calls[0][0];
    expect(input.hook_event_name).toBe("PostToolUseFailure");
    expect(input.error).toBe("boom");
    expect(input.is_interrupt).toBe(true);
  });

  it("fires PermissionRequest before asking the user", async () => {
    await firePermissionRequest("Edit", { path: "a.ts" });

    const input = fireEvent.mock.calls[0][0];
    expect(input.hook_event_name).toBe("PermissionRequest");
    expect(input.tool_name).toBe("Edit");
  });

  it("fires UserPromptSubmit with the prompt", async () => {
    await fireUserPromptSubmit("ship it");

    const input = fireEvent.mock.calls[0][0];
    expect(input.hook_event_name).toBe("UserPromptSubmit");
    expect(input.prompt).toBe("ship it");
  });

  it("fires SessionStart and SessionEnd with source and reason", async () => {
    await fireSessionStart("resume", "deepseek-chat");
    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "SessionStart",
      source: "resume",
      model: "deepseek-chat",
    });

    await fireSessionEnd("clear");
    expect(fireEvent.mock.calls[1][0]).toMatchObject({
      hook_event_name: "SessionEnd",
      reason: "clear",
    });
  });

  it("fires Stop with the last assistant message", async () => {
    await fireStop("all done");

    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "all done",
    });
  });

  it("fires SubagentStart and SubagentStop with the agent identity", async () => {
    await fireSubagentStart("agent-1", "explore");
    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "SubagentStart",
      agent_id: "agent-1",
      agent_type: "explore",
    });

    await fireSubagentStop("agent-1", "explore", "found it");
    expect(fireEvent.mock.calls[1][0]).toMatchObject({
      hook_event_name: "SubagentStop",
      agent_id: "agent-1",
      last_assistant_message: "found it",
    });
  });

  it("fires PreCompact with the trigger", async () => {
    await firePreCompact("auto");

    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "PreCompact",
      trigger: "auto",
      custom_instructions: null,
    });
  });

  it("fires ConfigChange with the source", async () => {
    await fireConfigChange("reload", "/tmp/config.yaml");

    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "ConfigChange",
      source: "reload",
      file_path: "/tmp/config.yaml",
    });
  });

  it("does not throw when the hook service rejects", async () => {
    fireEvent.mockRejectedValueOnce(new Error("hook crashed"));

    await expect(firePreToolUse("Bash", {}, "t")).rejects.toThrow(
      "hook crashed",
    );
  });
});
