import { render } from "ink-testing-library";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { promptMarker, UserInput } from "./UserInput.js";

/**
 * Frame-internal counting tests for the composer: two horizontal rules wrap
 * `> ` and the buffer's lines, and one footer row below carries the mode,
 * directory, model and reasoning depth. There are no side rails.
 */

const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const RULE = /^─+$/;

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

describe("composer layout", () => {
  beforeAll(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("wraps the input in two rules and keeps the footer below", async () => {
    const tree = await renderInput();
    try {
      const lines = (tree.lastFrame() ?? "").split("\n");
      // Top rule, input row, closing rule, footer: no blank filler rows.
      expect(lines).toHaveLength(4);
      expect(lines.filter((line) => line.trim() === "")).toHaveLength(0);
      expect(lines[0]).toMatch(RULE);
      expect(lines[1]).toContain(">");
      expect(lines[2]).toMatch(RULE);
      expect(lines[3]).toContain("Auto");
    } finally {
      tree.unmount();
    }
  });

  it("draws no side rails and shows the mode once", async () => {
    const tree = await renderInput();
    try {
      const frame = tree.lastFrame() ?? "";
      const rules = frame.split("\n").filter((line) => RULE.test(line));
      expect(rules).toHaveLength(2);
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
      const footer = (tree.lastFrame() ?? "").split("\n").at(-1) ?? "";
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
