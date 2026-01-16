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
    {
      name: "language",
      description: "d9",
      category: "system",
      subcommands: [
        { name: "en", description: "English" },
        { name: "zh-CN", description: "简体中文" },
      ],
    },
  ]),
}));

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/**
 * The palette used to print every command under the input box, and Enter on a
 * bare "/" ran the first of them. The palette is a short window above the
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

  it("updates the palette for input that arrives faster than a tick", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/");
      tree.stdin.write("he");
      await tick();

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("/help");
      expect(frame).not.toContain("/back");
    } finally {
      tree.unmount();
    }
  });

  it("refreshes the palette when rapid input is finalized", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("/back");

      tree.stdin.write("model " + "x".repeat(60));
      await tick(350);

      expect(tree.lastFrame() ?? "").not.toContain("/back");
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

  it("runs a typed prefix through the palette", async () => {
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

  it("opens a parent's children instead of running it", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/language");
      await tick();
      tree.stdin.write("\r");
      await tick();

      // Not submitted; completed with a space, which opens the second level.
      expect(onSubmit).not.toHaveBeenCalled();
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("-- /language --");
      expect(frame).toContain("English");
      expect(frame).toContain("简体中文");
    } finally {
      tree.unmount();
    }
  });

  it("runs a second-level entry as /parent child", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/language z");
      await tick();
      tree.stdin.write("\r");
      await tick();

      expect(onSubmit).toHaveBeenCalledWith("/language zh-CN");
    } finally {
      tree.unmount();
    }
  });

  it("escape closes the second level", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/language ");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("English");

      tree.stdin.write("\x1b");
      await tick();
      expect(tree.lastFrame() ?? "").not.toContain("English");
    } finally {
      tree.unmount();
    }
  });
});
