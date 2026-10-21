import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserInput } from "./UserInput.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "back", description: "d1", category: "system" },
    { name: "clear", description: "d2", category: "system" },
    { name: "compact", description: "d3", category: "system" },
    { name: "exit", description: "d4", category: "system" },
    { name: "help", description: "d5", category: "system" },
    { name: "model", description: "d6", category: "system" },
    { name: "plan", description: "d7", category: "system" },
    { name: "tools", description: "d8", category: "system" },
  ]),
}));

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/**
 * The palette used to print every command under the input box, and Enter on a
 * bare "/" ran the first of them. Pi's shape is a short window above the
 * composer, Enter completing an actual prefix, and an empty filter never
 * executing anything on its own.
 */
describe("UserInput slash palette", () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  const renderInput = async () => {
    const tree = render(
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />,
    );
    // The command list loads asynchronously; typing in the same synchronous
    // batch as the render would race it.
    await tick();
    return tree;
  };

  beforeEach(() => {
    onSubmit = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows at most five commands in a window above the composer", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/");
      await tick();

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("/back");
      expect(frame).not.toContain("/tools");

      const paletteIndex = frame.indexOf("/back");
      const composerIndex = frame.indexOf("│ > /");
      expect(paletteIndex).toBeGreaterThan(-1);
      expect(composerIndex).toBeGreaterThan(paletteIndex);
    } finally {
      tree.unmount();
    }
  });

  it("never executes a command from a bare slash plus Enter", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/");
      await tick();
      tree.stdin.write("\r");
      await tick();

      expect(onSubmit).not.toHaveBeenCalled();
      expect(tree.lastFrame() ?? "").toContain("/back");
    } finally {
      tree.unmount();
    }
  });

  it("runs a typed prefix through the palette like Pi", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/mo");
      await tick();
      tree.stdin.write("\r");
      await tick();

      expect(onSubmit).toHaveBeenCalledWith("/model");
    } finally {
      tree.unmount();
    }
  });
});
