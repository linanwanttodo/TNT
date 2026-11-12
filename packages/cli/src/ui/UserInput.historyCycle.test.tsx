import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "help", description: "help", category: "system" },
  ]),
}));

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/**
 * Walking submitted lines must come back to the blank composer on the last
 * down key, even when a recalled line opens the slash palette.
 */
describe("input history cycle", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-history-cycle-"));
    process.env.TNT_INPUT_HISTORY_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "input_history.json"),
      JSON.stringify([
        { text: "/help me", timestamp: 2 },
        { text: "hello there", timestamp: 1 },
      ]),
    );
  });

  afterEach(() => {
    delete process.env.TNT_INPUT_HISTORY_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns to the empty composer after the newest entry", async () => {
    const tree = render(
      <KeypressProvider>
        <UserInput
          onSubmit={vi.fn()}
          inputMode={true}
          isWaitingForResponse={false}
          assistant={{} as any}
        />
      </KeypressProvider>,
    );
    try {
      tree.stdin.write("\x1b[A"); // up: newest entry (/help me)
      await tick();
      expect(tree.lastFrame()).toContain("/help me");

      tree.stdin.write("\x1b[B"); // down: back to the blank composer
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame).not.toContain("/help me");
      expect(frame).toContain("Ask anything");
    } finally {
      tree.unmount();
    }
  });
});
