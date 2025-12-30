import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { UserInput } from "./UserInput.js";

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/**
 * Claude opens a mode menu on Shift+Tab instead of cycling through three
 * states. The menu lists the four interactive modes; dontAsk is headless and
 * serve semantics and never appears, and auto, the unimplemented classifier
 * mode, is not offered either.
 */
describe("UserInput mode menu", () => {
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
    await tick();
    return tree;
  };

  beforeEach(async () => {
    onSubmit = vi.fn();
    // The permission service is a singleton; earlier tests switch it.
    await services.toolPermissions.doInitialize({ mode: "default" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the five-entry menu on shift+tab", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("\x1b[Z"); // Shift+Tab
      await tick();

      const frame = tree.lastFrame() ?? "";
      for (const label of [
        "Manual",
        "Accept edits",
        "Plan",
        "Auto",
        "Bypass permissions",
      ]) {
        expect(frame).toContain(label);
      }
      // dontAsk is internal headless/serve semantics and never appears.
      expect(frame).not.toContain("Don't ask");
    } finally {
      tree.unmount();
    }
  });

  it("selects bypass permissions from the menu", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("\x1b[Z");
      await tick();
      tree.stdin.write("\x1b[B"); // down
      tree.stdin.write("\x1b[B"); // down
      tree.stdin.write("\x1b[B"); // down
      tree.stdin.write("\x1b[B"); // down
      await tick();
      tree.stdin.write("\r"); // select Bypass permissions
      await tick();

      expect(tree.lastFrame() ?? "").toContain("[Bypass permissions]");
    } finally {
      tree.unmount();
    }
  });

  it("refuses auto with the classifier reason instead of switching", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("\x1b[Z");
      await tick();
      tree.stdin.write("\x1b[B"); // down
      tree.stdin.write("\x1b[B"); // down
      tree.stdin.write("\x1b[B"); // down
      await tick();
      tree.stdin.write("\r"); // Auto
      await tick();

      const frame = tree.lastFrame() ?? "";
      // The stub mode is refused: the badge is unchanged and the menu closed.
      // The reason rides the chat history in the full application.
      expect(frame).toContain("[Manual]");
      expect(frame).not.toContain("not implemented");
    } finally {
      tree.unmount();
    }
  });

  it("escape closes the menu without changing the mode", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("\x1b[Z");
      await tick();
      tree.stdin.write("\x1b"); // Esc
      await tick();

      const frame = tree.lastFrame() ?? "";
      expect(frame).not.toContain("Allow every tool");
      expect(frame).toContain("[Manual]");
    } finally {
      tree.unmount();
    }
  });
});
