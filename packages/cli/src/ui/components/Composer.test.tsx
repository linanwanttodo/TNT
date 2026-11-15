import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearClickRegions, dispatchClick } from "../utils/clickRegions.js";

import { Composer } from "./Composer.js";

vi.mock("./ScreenContent.js", () => ({ ScreenContent: () => null }));
vi.mock("./BottomStatusBar.js", () => ({ BottomStatusBar: () => null }));
vi.mock("./ResourceDebugBar.js", () => ({ ResourceDebugBar: () => null }));

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function renderComposer(following: boolean, onJumpToLatest = vi.fn()) {
  const props = {
    following,
    statusMessage: "",
    onJumpToLatest,
    isVerboseMode: false,
  } as any;
  const tree = render(<Composer {...props} />);
  return { tree, onJumpToLatest };
}

afterEach(() => {
  clearClickRegions();
});

describe("Composer jump hint", () => {
  it("jumps to the latest message when the hint row is clicked", async () => {
    const { tree, onJumpToLatest } = renderComposer(false);

    try {
      await tick();
      expect(tree.lastFrame() ?? "").toContain("Jump to latest message");
      expect(dispatchClick(1, 40)).toBe(true);
      expect(onJumpToLatest).toHaveBeenCalledTimes(1);
    } finally {
      tree.unmount();
    }
  });

  it("leaves a click on the blank reserved row alone at the tail", async () => {
    const { tree, onJumpToLatest } = renderComposer(true);

    try {
      await tick();
      expect(tree.lastFrame() ?? "").not.toContain("Jump to latest message");
      dispatchClick(1, 40);
      expect(onJumpToLatest).not.toHaveBeenCalled();
    } finally {
      tree.unmount();
    }
  });
});
