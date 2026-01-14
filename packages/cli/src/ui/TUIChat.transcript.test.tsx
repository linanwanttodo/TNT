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

// The intro is a live-frame element; hiding it keeps the transcript and the
// composer adjacent, which is what the ordering assertions look for.
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

  const chatState = (overrides: Record<string, unknown> = {}) => ({
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

  const renderChat = (overrides: Record<string, unknown> = {}) => {
    mockUseChat.mockReturnValue(chatState(overrides));

    return render(<AppRoot />);
  };

  const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

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

  it("clips the transcript to the viewport instead of printing it all", () => {
    const { lastFrame, unmount } = renderChat();

    try {
      const frame = lastFrame() ?? "";

      // The alternate screen is only twelve rows tall here, so the newest
      // exchange is on screen and the beginning of the conversation is not.
      expect(frame).toContain("answer 20");
      expect(frame).not.toMatch(/\bquestion 1\b/);
    } finally {
      unmount();
    }
  });

  it("pins the composer below the newest answer at the bottom", () => {
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
      // The frame stays inside the twelve rows it was given.
      expect(lines.length).toBeLessThanOrEqual(12);
    } finally {
      unmount();
    }
  });

  it("shows the jump hint and older rows after scrolling back", async () => {
    const { lastFrame, stdin, unmount } = renderChat();

    try {
      stdin.write("\x1b[5~"); // PageUp
      await new Promise((resolve) => setTimeout(resolve, 50));

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Jump to latest message");
      // The window has moved back: an earlier answer becomes reachable.
      expect(frame).toMatch(/answer (1[0-9]|[1-9])\b/);

      stdin.write("\x1b[4~"); // End returns to the live tail
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(lastFrame() ?? "").not.toContain("Jump to latest message");
    } finally {
      unmount();
    }
  });

  it("fills the viewport with real rows after scrolling back", async () => {
    const { lastFrame, stdin, unmount } = renderChat();

    try {
      stdin.write("\x1b[5~"); // PageUp
      await tick();

      const lines = (lastFrame() ?? "").split("\n");
      const hintIndex = lines.findIndex((line) =>
        line.includes("Jump to latest message"),
      );
      const transcriptRows = lines
        .slice(0, hintIndex < 0 ? lines.length : hintIndex)
        .filter((line) => line.trim() !== "");

      // The old viewport stepped a whole message at a time, so a scroll often
      // left the box with one row and a screen of blank space.
      expect(transcriptRows.length).toBeGreaterThanOrEqual(3);
    } finally {
      unmount();
    }
  });

  it("moves one row per wheel notch instead of one message", async () => {
    const { lastFrame, stdin, unmount } = renderChat();

    try {
      await tick();
      expect(lastFrame() ?? "").toContain("answer 20");

      stdin.write("\x1b[<64;10;10M"); // one wheel notch up
      await tick();

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Jump to latest message");
      // A notch hides one row, not the whole newest answer.
      expect(frame).toContain("answer 20");
    } finally {
      unmount();
    }
  });

  it("scrolls inside one tall answer without dropping it", async () => {
    const tallAnswer = Array.from(
      { length: 60 },
      (_, index) => `answer-row-${index + 1}`,
    ).join("\n");
    const { lastFrame, stdin, unmount } = renderChat({
      chatHistory: [
        {
          message: { role: "user", content: "tall question" },
          contextItems: [],
        },
        {
          message: { role: "assistant", content: tallAnswer },
          contextItems: [],
        },
      ],
    });

    try {
      await tick();
      expect(lastFrame() ?? "").toContain("answer-row-60");

      stdin.write("\x1b[5~"); // PageUp
      await tick();

      const frame = lastFrame() ?? "";
      // Still inside the same answer, a page above its end. The item-based
      // window used to skip the entire answer on this key press.
      expect(frame).toMatch(/answer-row-(4[0-9]|5[0-9])/);
      expect((frame.match(/answer-row-/g) ?? []).length).toBeGreaterThanOrEqual(
        3,
      );
      expect(frame).not.toContain("tall question");
    } finally {
      unmount();
    }
  });

  it("expands a finished tool panel on click and folds it on the next click", async () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `output-line-${index + 1}`,
    ).join("\n");
    const { lastFrame, stdin, unmount } = renderChat({
      chatHistory: [
        {
          message: { role: "assistant", content: "" },
          contextItems: [],
          toolCallStates: [
            {
              toolCallId: "call-1",
              toolCall: {
                id: "call-1",
                type: "function",
                function: { name: "Bash", arguments: '{"command":"echo hi"}' },
              },
              status: "done",
              parsedArgs: { command: "echo hi" },
              output: [
                {
                  id: "out-1",
                  name: "Bash",
                  description: "",
                  content: output,
                },
              ],
            },
          ],
        },
      ],
    });

    const clickRow = async (needle: string) => {
      const row =
        (lastFrame() ?? "")
          .split("\n")
          .findIndex((line) => line.includes(needle)) + 1;
      expect(row).toBeGreaterThan(0);
      stdin.write(`\x1b[<0;5;${row}M`);
      await tick();
    };

    try {
      await tick();
      expect(lastFrame() ?? "").toContain("earlier lines, click to expand");

      await clickRow("output-line-10");
      await tick();
      expect(lastFrame() ?? "").toContain("click to collapse");

      await clickRow("output-line-10");
      expect(lastFrame() ?? "").toContain("earlier lines, click to expand");
    } finally {
      unmount();
    }
  });

  it("holds the reader's position while an answer streams", async () => {
    const { lastFrame, stdin, rerender, unmount } = renderChat();

    try {
      await tick();
      stdin.write("\x1b[5~"); // PageUp
      await tick();

      const marker = (lastFrame() ?? "")
        .split("\n")
        .find((line) => /answer (1[0-9]|[1-9])\b/.test(line));
      expect(marker).toBeTruthy();

      mockUseChat.mockReturnValue(
        chatState({ streamingText: "streaming tail marker" }),
      );
      rerender(<AppRoot />);
      await tick();

      // New rows land below the viewport; the reader keeps their place and
      // does not get yanked back to the tail.
      expect(lastFrame() ?? "").toContain(marker!);
      expect(lastFrame() ?? "").not.toContain("streaming tail marker");

      stdin.write("\x1b[4~"); // End
      await tick();
      expect(lastFrame() ?? "").toContain("streaming tail marker");
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

  it("shows the streaming answer while it arrives", async () => {
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
});
