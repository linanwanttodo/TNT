import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe("TUIChat - Interruption UI (Minimal Test)", () => {
  afterEach(() => {
    for (const tree of mounted) tree.unmount();
    mounted.length = 0;
    vi.useRealTimers();
  });

  it("keeps typed text in the composer and shows no notice row", async () => {
    // Real timers: the React commits that paint the buffer depend on them.
    vi.useRealTimers();
    const mockOnSubmit = vi.fn();
    const mockOnInterrupt = vi.fn();

    const { stdin, lastFrame, unmount } = track(
      <KeypressProvider>
        <UserInput
          onSubmit={mockOnSubmit}
          inputMode={true}
          disabled={false}
          isWaitingForResponse={false}
          onInterrupt={mockOnInterrupt}
        />
      </KeypressProvider>,
    );

    try {
      stdin.write("hello without reply");
      await tick();
      await tick();
      expect(lastFrame()).toContain("hello without reply");

      stdin.write("\x1b");
      await tick(120);
      expect(lastFrame()).toContain("hello without reply");
      expect(lastFrame()).not.toContain("Press enter to continue");
      expect(lastFrame()).not.toContain("已由用户中断");
    } finally {
      unmount();
    }
  });

  it("keeps the composer clean of a dedicated interruption row", () => {
    vi.useRealTimers();
    const mockOnSubmit = vi.fn();
    const { lastFrame, unmount } = track(
      <KeypressProvider>
        <UserInput
          onSubmit={mockOnSubmit}
          inputMode={true}
          disabled={false}
          isWaitingForResponse={false}
          wasInterrupted
        />
      </KeypressProvider>,
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("已由用户中断");
      expect(frame).not.toContain("Interrupted by user");
    } finally {
      unmount();
    }
  });
});
