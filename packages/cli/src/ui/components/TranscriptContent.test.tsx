import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { TranscriptContent } from "./TranscriptContent.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30, isResizing: false }),
}));

vi.mock("../IntroMessage.js", () => ({
  IntroMessage: () => <Text>TNT banner</Text>,
}));

const item = (role: string, content: string): ChatHistoryItem =>
  ({ message: { role, content }, contextItems: [] }) as ChatHistoryItem;

const noMetrics = vi.fn();

const renderTranscript = (
  chatHistory: ChatHistoryItem[],
  {
    showIntroMessage = false,
    queued = [],
    streamingReasoning = null,
  }: {
    showIntroMessage?: boolean;
    queued?: Array<{ message: string }>;
    streamingReasoning?: string | null;
  } = {},
) =>
  render(
    <TranscriptContent
      showIntroMessage={showIntroMessage}
      chatHistory={chatHistory}
      queuedMessages={queued as never}
      renderMessage={(message, index) => (
        <Text key={index}>{String(message.message.content)}</Text>
      )}
      streamingReasoning={streamingReasoning}
      scrollTop={0}
      onMetrics={noMetrics}
      isWaitingForResponse={false}
      responseStartTime={null}
      isCompacting={false}
      compactionStartTime={null}
      isBashToolRunning={false}
    />,
  );

describe("TranscriptContent", () => {
  it("renders reasoning while it is still arriving", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      streamingReasoning: "Looking at the files",
    });

    try {
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Looking at the files");
    } finally {
      unmount();
    }
  });

  it("renders the banner while the conversation is empty", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      showIntroMessage: true,
    });

    try {
      expect(lastFrame() ?? "").toContain("TNT banner");
    } finally {
      unmount();
    }
  });

  it("removes the banner after the first message", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("user", "first question")],
      { showIntroMessage: true },
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("TNT banner");
      expect(frame).toContain("first question");
    } finally {
      unmount();
    }
  });

  it("keeps settled messages before the live answer", () => {
    const { lastFrame, unmount } = renderTranscript([
      item("user", "first question"),
      item("assistant", "streaming answer"),
    ]);

    try {
      const frame = lastFrame() ?? "";
      expect(frame.indexOf("first question")).toBeLessThan(
        frame.indexOf("streaming answer"),
      );
    } finally {
      unmount();
    }
  });

  it("renders queued messages after the transcript", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("assistant", "last answer")],
      { queued: [{ message: "queued follow-up" }] },
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame.indexOf("last answer")).toBeLessThan(
        frame.indexOf("queued follow-up"),
      );
    } finally {
      unmount();
    }
  });

  it("does not print a terminal-height blank anchor", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      showIntroMessage: true,
    });

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const first = lines.find((line) => line.trim() !== "");
      expect(first).toContain("TNT banner");
    } finally {
      unmount();
    }
  });
});
