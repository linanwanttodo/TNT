import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InterruptedNotice } from "./components/Composer.js";
import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

// AppRoot subscribes a dozen services through useServices, so every case that
// leaves it mounted keeps those handlers attached to the shared container.
const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

describe("TUIChat - Interruption UI (Minimal Test)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const tree of mounted) tree.unmount();
    mounted.length = 0;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows interruption message when wasInterrupted is true", () => {
    const { lastFrame, rerender, unmount } = track(
      <InterruptedNotice visible={false} />,
    );

    try {
      // Initial render - no interruption message
      let frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame).not.toContain("Interrupted by user");
      expect(frame).not.toContain("Press enter to continue");

      // Re-render with wasInterrupted: true
      rerender(<InterruptedNotice visible />);

      // Should show interruption message
      frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain("Interrupted by user");
      expect(frame).toContain("Press enter to continue");
    } finally {
      unmount();
    }
  });

  it("hides interruption message when wasInterrupted is false", () => {
    const { lastFrame, rerender, unmount } = track(
      <InterruptedNotice visible />,
    );

    try {
      // Initial render - should show interruption message
      let frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain("Interrupted by user");
      expect(frame).toContain("Press enter to continue");

      // Re-render with wasInterrupted: false
      rerender(<InterruptedNotice visible={false} />);

      // Should not show interruption message
      frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame).not.toContain("Interrupted by user");
      expect(frame).not.toContain("Press enter to continue");
    } finally {
      unmount();
    }
  });

  it("calls onSubmit with empty string when Enter is pressed while interrupted", () => {
    const mockOnSubmit = vi.fn();
    const mockOnInterrupt = vi.fn();

    const { stdin, unmount } = track(
      React.createElement(
        KeypressProvider,
        null,
        React.createElement(UserInput, {
          onSubmit: mockOnSubmit,
          isWaitingForResponse: false,
          inputMode: true,
          onInterrupt: mockOnInterrupt,
          wasInterrupted: true, // Interrupted state
        }),
      ),
    );

    try {
      // Press Enter while in interrupted state
      stdin.write("\r");

      // Should call onSubmit with empty string (for resume)
      expect(mockOnSubmit).toHaveBeenCalledWith("", expect.any(Map));
    } finally {
      unmount();
    }
  });

  it("calls onSubmit with typed content when typing new message after interruption", async () => {
    // Real timers: the parser's fast-return window needs a real pause between
    // the typed run and the confirming Enter.
    vi.useRealTimers();
    const mockOnSubmit = vi.fn();
    const mockOnInterrupt = vi.fn();

    const { stdin, unmount } = track(
      React.createElement(
        KeypressProvider,
        null,
        React.createElement(UserInput, {
          onSubmit: mockOnSubmit,
          isWaitingForResponse: false,
          inputMode: true,
          onInterrupt: mockOnInterrupt,
          wasInterrupted: true, // Interrupted state
        }),
      ),
    );

    try {
      // Type a new message, then Enter after a real pause: the parser
      // rewrites an Enter that lands within 30ms of typing into a newline.
      stdin.write("New message after interruption");
      await new Promise((resolve) => setTimeout(resolve, 60));
      stdin.write("\r");
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should call onSubmit with the typed content
      expect(mockOnSubmit).toHaveBeenCalledWith(
        "New message after interruption",
        expect.any(Map),
      );
    } finally {
      unmount();
    }
  });

  it("draws the interruption hint in the footer, below the input", () => {
    const mockOnSubmit = vi.fn();
    const mockOnInterrupt = vi.fn();

    const { lastFrame, unmount } = track(
      <KeypressProvider>
        <UserInput
          onSubmit={mockOnSubmit}
          isWaitingForResponse={false}
          inputMode={true}
          onInterrupt={mockOnInterrupt}
          wasInterrupted
        />
        <InterruptedNotice visible />
      </KeypressProvider>,
    );

    try {
      const frame = lastFrame();
      expect(frame).toBeDefined();

      const frameLines = frame?.split("\n") || [];
      const foundInterruptionLine = frameLines.findIndex((line) =>
        line.includes("Interrupted by user"),
      );
      const foundInputLine = frameLines.findIndex((line) =>
        line.includes("> "),
      );

      expect(foundInterruptionLine).toBeGreaterThan(-1);
      expect(foundInputLine).toBeGreaterThan(-1);
      // The hint belongs to the composer footer, under the input, not to the
      // input's own dock.
      expect(foundInterruptionLine).toBeGreaterThan(foundInputLine);
    } finally {
      unmount();
    }
  });
});
