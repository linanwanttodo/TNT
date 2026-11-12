import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "back", description: "d1", category: "system" },
    { name: "clear", description: "d2", category: "system" },
  ]),
}));

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

describe("slash palette tab completion", () => {
  it("completes the highlighted command on tab from a bare slash", async () => {
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
      tree.stdin.write("/");
      await tick();
      tree.stdin.write("\x1b[B"); // move the selection down
      await tick();
      tree.stdin.write("\t");
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("> /clear");
    } finally {
      tree.unmount();
    }
  });

  it("shows only the position counter below the palette", async () => {
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
      tree.stdin.write("/");
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame).toMatch(/\(\d+\/\d+\)/);
      expect(frame).not.toContain("to navigate");
      expect(frame).not.toContain("Tab to complete");
    } finally {
      tree.unmount();
    }
  });
});
