import { render } from "ink-testing-library";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { promptMarker, UserInput } from "./UserInput.js";

/**
 * Frame-internal counting tests for the gemini-style composer: a solid
 * surface band around `> ` and the buffer's lines, and one footer row below
 * with the mode, directory, model and reasoning depth. There are no rule
 * lines and no side rails any more.
 */

const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const renderInput = async () => {
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
  await tick();
  return tree;
};

describe("gemini composer layout", () => {
  beforeAll(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reserves exactly two rows: the input band and the footer", async () => {
    const tree = await renderInput();
    try {
      const lines = (tree.lastFrame() ?? "").split("\n");
      // No blank filler rows between the composer and the footer: the dock
      // is two lines, not a stack of rules and hints.
      expect(lines).toHaveLength(2);
      expect(lines.filter((line) => line.trim() === "")).toHaveLength(0);
      expect(lines[0]).toContain(">");
      expect(lines[1]).toContain("Auto");
    } finally {
      tree.unmount();
    }
  });

  it("drops the claude-code rule frame and shows the mode once", async () => {
    const tree = await renderInput();
    try {
      const frame = tree.lastFrame() ?? "";
      expect(frame).not.toContain("─");
      expect(frame).not.toContain("│");
      expect(frame).not.toContain("[Auto]");
      expect(frame.split("Auto")).toHaveLength(2);
    } finally {
      tree.unmount();
    }
  });

  it("shows the working directory on the same footer row as the mode", async () => {
    const tree = await renderInput();
    try {
      const [, footer] = (tree.lastFrame() ?? "").split("\n");
      expect(footer).toContain("Auto");
      // POSIX home collapses to `~`; Windows keeps its drive path, so the
      // assertion accepts either separator rather than assuming `/`.
      expect(footer).toMatch(/~|[\\/]/);
    } finally {
      tree.unmount();
    }
  });

  it("uses the gemini pointer, not the claude pointer", async () => {
    const tree = await renderInput();
    try {
      expect(tree.lastFrame()).toContain("> ");
      expect(tree.lastFrame()).not.toContain("❯ ");
    } finally {
      tree.unmount();
    }
  });
});

describe("promptMarker", () => {
  it("uses the gemini pointer at rest", () => {
    expect(promptMarker({ bash: false, remote: false, busy: false })).toEqual({
      glyph: "> ",
      tone: "subtle",
      dim: false,
    });
  });

  it("dims the pointer while a turn is running", () => {
    expect(promptMarker({ bash: false, remote: false, busy: true }).dim).toBe(
      true,
    );
  });

  it("keeps the shell and remote marks distinct", () => {
    expect(promptMarker({ bash: true, remote: false, busy: false }).glyph).toBe(
      "$ ",
    );
    expect(promptMarker({ bash: false, remote: true, busy: false }).glyph).toBe(
      "◉ ",
    );
  });
});
