import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";

import { AppRoot } from "./AppRoot.js";

// Mock the useChat hook to control state
const mockUseChat = vi.fn();
const mockHandleInterrupt = vi.fn();

vi.mock("./hooks/useChat.js", () => ({
  useChat: () => mockUseChat(),
}));

// The mounted tree subscribes through the service hooks, so a case that leaves
// it in place keeps those handlers on the shared container for later cases.
const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

describe("TUIChat - Compaction Cancellation", () => {
  let context: any;

  beforeEach(() => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
    });

    // Reset the mock
    mockHandleInterrupt.mockClear();
  });

  afterEach(() => {
    for (const tree of mounted) tree.unmount();
    mounted.length = 0;
    context.cleanup();
    vi.clearAllMocks();
  });

  it("calls handleInterrupt when ESC is pressed during compaction", async () => {
    const compactionStartTime = Date.now();

    mockUseChat.mockReturnValue({
      chatHistory: [],
      setChatHistory: vi.fn(),
      isWaitingForResponse: false,
      responseStartTime: null,
      isCompacting: true,
      compactionStartTime,
      inputMode: true, // Changed to true so ESC handling is active
      attachedFiles: [],
      activePermissionRequest: null,
      wasInterrupted: false,
      handleUserMessage: vi.fn(),
      handleInterrupt: mockHandleInterrupt,
      handleFileAttached: vi.fn(),
      resetChatHistory: vi.fn(),
      handleToolPermissionResponse: vi.fn(),
    });

    const { stdin } = track(React.createElement(AppRoot, {}));

    // Simulate ESC key press during compaction. Ink waits a tick for the rest of
    // an escape sequence before delivering a bare ESC, so the assertion has to
    // wait for the key to be handled - an assertion inside a setTimeout that the
    // test never awaited reported nothing either way.
    stdin.write("\x1b"); // ESC key
    await vi.waitFor(() =>
      expect(mockHandleInterrupt).toHaveBeenCalledTimes(1),
    );
  });

  it("shows compaction status with esc to interrupt message", () => {
    const compactionStartTime = Date.now();

    mockUseChat.mockReturnValue({
      chatHistory: [],
      setChatHistory: vi.fn(),
      isWaitingForResponse: false,
      responseStartTime: null,
      isCompacting: true,
      compactionStartTime,
      inputMode: false,
      attachedFiles: [],
      activePermissionRequest: null,
      wasInterrupted: false,
      handleUserMessage: vi.fn(),
      handleInterrupt: mockHandleInterrupt,
      handleFileAttached: vi.fn(),
      resetChatHistory: vi.fn(),
      handleToolPermissionResponse: vi.fn(),
    });

    const { lastFrame, unmount } = track(React.createElement(AppRoot, {}));

    try {
      const frame = lastFrame();
      expect(frame).toBeDefined();

      // Should show compaction message with interrupt option
      expect(frame).toContain("Compacting history");
      expect(frame).toContain("esc to interrupt");
    } finally {
      unmount();
    }
  });

  it("prioritizes compaction cancellation over response cancellation", async () => {
    // This tests the case where both might be true (theoretical edge case)
    const compactionStartTime = Date.now();
    const responseStartTime = Date.now();

    mockUseChat.mockReturnValue({
      chatHistory: [],
      setChatHistory: vi.fn(),
      isWaitingForResponse: true,
      responseStartTime,
      isCompacting: true,
      compactionStartTime,
      inputMode: false,
      attachedFiles: [],
      activePermissionRequest: null,
      wasInterrupted: false,
      handleUserMessage: vi.fn(),
      handleInterrupt: mockHandleInterrupt,
      handleFileAttached: vi.fn(),
      resetChatHistory: vi.fn(),
      handleToolPermissionResponse: vi.fn(),
    });

    const { stdin } = track(React.createElement(AppRoot, {}));

    // Simulate ESC key press when both states are active
    stdin.write("\x1b"); // ESC key

    // Should still call handleInterrupt (which will prioritize compaction)
    await vi.waitFor(() =>
      expect(mockHandleInterrupt).toHaveBeenCalledTimes(1),
    );
  });
});
