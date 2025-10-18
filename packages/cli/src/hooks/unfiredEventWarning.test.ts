import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../utils/logger.js";

import { loadHooksConfig } from "./hookConfig.js";

const warned = (text: string) =>
  vi
    .mocked(logger.warn)
    .mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes(text)),
    );

describe("a hooks file that names an event this CLI never fires", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hook-events-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hook-home-"));
    fs.mkdirSync(path.join(cwd, ".tnt"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeHooks = (events: string[]) => {
    fs.writeFileSync(
      path.join(cwd, ".tnt", "settings.json"),
      JSON.stringify({
        hooks: Object.fromEntries(
          events.map((event) => [
            event,
            [{ matcher: "", hooks: [{ type: "command", command: "true" }] }],
          ]),
        ),
      }),
    );
  };

  it("says so instead of letting the configuration look active", () => {
    writeHooks(["WorktreeCreate"]);

    const loaded = loadHooksConfig(cwd, home);

    expect(loaded.hooks.WorktreeCreate).toBeDefined();
    expect(warned("never fires")).toBe(true);
    expect(warned("WorktreeCreate")).toBe(true);
  });

  it("says nothing about an event that really runs", () => {
    writeHooks(["PreToolUse"]);

    loadHooksConfig(cwd, home);

    expect(warned("never fires")).toBe(false);
  });
});
