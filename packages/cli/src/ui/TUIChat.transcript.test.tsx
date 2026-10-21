import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";

import { AppRoot } from "./AppRoot.js";

const mockUseChat = vi.fn();

vi.mock("./hooks/useChat.js", () => ({
  useChat: () => mockUseChat(),
}));

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 12, isResizing: false }),
}));

// The intro would fill the viewport's leftover rows; hiding it keeps the gap
// between the transcript and a composer-pinned spinner observable.
vi.mock("./hooks/useTUIChatHooks.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIntroMessage: () => [false, vi.fn()] as const,
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
      streamingText: null,
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

  it("keeps the newest transcript visible inside the viewport", () => {
    const { lastFrame, unmount } = renderChat();

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");

      // The viewport is one terminal tall; older turns clip at the top and
      // the newest answer stays above the composer.
      expect(frame).toContain("answer 20");
      expect(frame).not.toMatch(/\banswer 1\b(?!\d)/);
      expect(lines.length).toBeLessThanOrEqual(12);
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

  it("renders the working spinner directly below the newest message", async () => {
    const { lastFrame, unmount } = renderChat({
      chatHistory: conversation(1),
      isWaitingForResponse: true,
      responseStartTime: Date.now(),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const lines = (lastFrame() ?? "").split("\n");
      const messageIndex = lines.findIndex((line) => line.includes("answer 1"));
      const spinnerIndex = lines.findIndex((line) =>
        line.includes("esc to interrupt"),
      );

      expect(messageIndex).toBeGreaterThan(-1);
      expect(spinnerIndex).toBeGreaterThan(messageIndex);
      // The spinner lives in the transcript flow, not pinned above the
      // composer with the leftover rows in between.
      expect(spinnerIndex - messageIndex).toBeLessThanOrEqual(2);
    } finally {
      unmount();
    }
  });

  it("renders the streaming answer while it arrives", async () => {
    const { lastFrame, unmount } = renderChat({
      chatHistory: conversation(1),
      streamingText: "half written answer",
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const lines = (lastFrame() ?? "").split("\n");
      const streamIndex = lines.findIndex((line) =>
        line.includes("half written answer"),
      );
      const composerIndex = lines.findIndex((line) =>
        line.includes("Ask anything"),
      );

      expect(streamIndex).toBeGreaterThan(-1);
      expect(streamIndex).toBeLessThan(composerIndex);
    } finally {
      unmount();
    }
  });

  it("shows the jump-to-latest hint above the composer only while scrolled up", async () => {
    const { lastFrame, stdin, unmount } = renderChat();

    try {
      expect(lastFrame() ?? "").not.toContain("Jump to latest");

      stdin.write("\x1b[5~"); // PageUp
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(lastFrame() ?? "").toContain("Jump to latest");

      stdin.write("\x1b[F"); // End returns to the live tail
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(lastFrame() ?? "").not.toContain("Jump to latest");
    } finally {
      unmount();
    }
  });
});
