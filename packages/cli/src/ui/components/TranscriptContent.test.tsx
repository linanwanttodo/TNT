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

const renderTranscript = (
  chatHistory: ChatHistoryItem[],
  {
    liveItemCount = 0,
    showIntroMessage = false,
    queued = [],
  }: {
    liveItemCount?: number;
    showIntroMessage?: boolean;
    queued?: Array<{ message: string }>;
  } = {},
) =>
  render(
    <TranscriptContent
      showIntroMessage={showIntroMessage}
      chatHistory={chatHistory}
      queuedMessages={queued as never}
      renderMessage={(message) => (
        <Text>{String(message.message.content)}</Text>
      )}
      liveItemCount={liveItemCount}
    />,
  );

describe("TranscriptContent", () => {
  it("renders the banner before the transcript", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("user", "first question")],
      { showIntroMessage: true },
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame.indexOf("TNT banner")).toBeGreaterThanOrEqual(0);
      expect(frame.indexOf("TNT banner")).toBeLessThan(
        frame.indexOf("first question"),
      );
    } finally {
      unmount();
    }
  });

  it("keeps settled messages before the live answer", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("user", "first question"), item("assistant", "streaming answer")],
      { liveItemCount: 1 },
    );

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
    const { lastFrame, unmount } = renderTranscript(
      [item("user", "first question")],
      { showIntroMessage: true },
    );

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const first = lines.find((line) => line.trim() !== "");
      expect(first).toContain("TNT banner");
    } finally {
      unmount();
    }
  });
});
