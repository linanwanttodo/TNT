import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../test-utils/ui-test-context.js";
import { AppRoot } from "./AppRoot.js";

const mockUseChat = vi.fn();

vi.mock("./hooks/useChat.js", () => ({
  useChat: () => mockUseChat(),
}));

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 12, isResizing: false }),
}));

describe("TUIChat transcript", () => {
  let context: any;

  const conversation = (turns: number) =>
    Array.from({ length: turns }, (_, index) => [
      {
        message: { role: "user", content: `question ${index + 1}` },
        contextItems: [],
      },
      {
        message: { role: "assistant", content: `answer ${index + 1}` },
        contextItems: [],
      },
    ]).flat();

  const renderChat = (overrides: Record<string, unknown> = {}) => {
    mockUseChat.mockReturnValue({
      chatHistory: conversation(20),
      setChatHistory: vi.fn(),
      isWaitingForResponse: false,
      responseStartTime: null,
      isCompacting: false,
      compactionStartTime: null,
      inputMode: true,
      attachedFiles: [],
      activePermissionRequest: null,
      wasInterrupted: false,
      handleUserMessage: vi.fn(),
      handleInterrupt: vi.fn(),
      handleFileAttached: vi.fn(),
      resetChatHistory: vi.fn(),
      handleToolPermissionResponse: vi.fn(),
      ...overrides,
    });

    return render(<AppRoot />);
  };

  beforeEach(() => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
    });
  });

  afterEach(() => {
    context.cleanup();
    vi.clearAllMocks();
  });

  it("prints the whole transcript instead of clipping it to the viewport", () => {
    const { lastFrame, unmount } = renderChat();

    try {
      const frame = lastFrame() ?? "";

      // The old fixed-height viewport dropped everything above the newest
      // screenful; nothing may be dropped now.
      expect(frame).toContain("question 1");
      expect(frame).toContain("answer 10");
      expect(frame).toContain("answer 20");
    } finally {
      unmount();
    }
  });

  it("keeps the composer directly below the newest answer", () => {
    const { lastFrame, unmount } = renderChat();

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const answerIndex = lines.findIndex((line) => line.includes("answer 20"));
      const composerIndex = lines.findIndex((line) =>
        line.includes("Ask anything"),
      );

      expect(answerIndex).toBeGreaterThan(-1);
      expect(composerIndex).toBeGreaterThan(answerIndex);
      // The composer box is drawn in full: top border, prompt, bottom border.
      expect(lines[composerIndex - 1]).toContain("╭");
      expect(lines[composerIndex + 1]).toContain("╰");
    } finally {
      unmount();
    }
  });

  it("has no in-app scroll affordance to fight the terminal scrollback", () => {
    const { lastFrame, unmount } = renderChat();

    try {
      expect(lastFrame() ?? "").not.toContain("Jump to latest");
    } finally {
      unmount();
    }
  });
});
