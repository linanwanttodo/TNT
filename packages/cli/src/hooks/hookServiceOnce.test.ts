import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, describe, expect, it, vi } from "vitest";

// hookRunner reaches for the service registry, and that module constructs a
// HookService; mocked here so importing the class does not run into its own
// half-initialized module.
vi.mock("../services/index.js", () => ({
  services: {},
  serviceContainer: { get: async () => ({}) },
}));

import { HookService } from "./HookService.js";
import type { PreToolUseInput } from "./types.js";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hook-service-"));

afterAll(() => {
  return fs.promises.rm(workDir, { recursive: true, force: true });
});

function input(): PreToolUseInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    transcript_path: "",
    cwd: workDir,
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "tool-1",
  };
}

/**
 * The runner only spends a `once` handler when the service hands it the set that
 * lives as long as the process, so the wiring is what this pins.
 */
describe("HookService once wiring", () => {
  it("runs a once handler for the first event of the process only", async () => {
    const counter = path.join(workDir, "service-once-count");
    const service = new HookService();
    const state = service.getState();
    state.disabled = false;
    state.config.PreToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"`,
            once: true,
          },
        ],
      },
    ];

    await service.fireEvent(input());
    await service.fireEvent(input());

    const runs = Number((await fs.promises.readFile(counter, "utf-8")).trim());
    expect(runs).toBe(1);
    expect(service.getState().onceKeys.size).toBe(1);
  }, 30_000);

  it("keeps spent handlers spent across a config reload", async () => {
    const counter = path.join(workDir, "reload-count");
    const service = new HookService();
    service.getState().config.PreToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"`,
            once: true,
          },
        ],
      },
    ];

    await service.fireEvent(input());
    // A reload replaces the config it fires from; the set is the process's
    // memory of what already ran, so the same handler stays spent.
    await service.reloadConfig();
    service.getState().config.PreToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"`,
            once: true,
          },
        ],
      },
    ];
    await service.fireEvent(input());

    expect(Number((await fs.promises.readFile(counter, "utf-8")).trim())).toBe(
      1,
    );
  }, 30_000);
});
