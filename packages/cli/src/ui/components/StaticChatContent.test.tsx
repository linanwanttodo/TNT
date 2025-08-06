import { EventEmitter } from "node:events";

import { render as inkRender, Text } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { StaticChatContent } from "./StaticChatContent.js";

/**
 * Records every chunk Ink writes to the terminal, with debug output off, so a
 * test can tell what is printed once from what is redrawn in the live frame.
 */
class CaptureStdout extends EventEmitter {
  columns = 100;
  rows = 40;
  isTTY = true;
  chunks: string[] = [];

  write = (chunk: string) => {
    this.chunks.push(chunk);
    return true;
  };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => null;
}

const item = (role: string, content: string): ChatHistoryItem =>
  ({ message: { role, content }, contextItems: [] }) as ChatHistoryItem;

const renderTranscript = (
  chatHistory: ChatHistoryItem[],
  liveItemCount: number,
  showIntroMessage = false,
) => {
  const stdout = new CaptureStdout();
  const stdin = new FakeStdin();

  const instance = inkRender(
    <StaticChatContent
      showIntroMessage={showIntroMessage}
      chatHistory={chatHistory}
      renderMessage={(message) => (
        <Text key={String(message.message.content)}>
          {String(message.message.content)}
        </Text>
      )}
      liveItemCount={liveItemCount}
    />,
    {
      stdout: stdout as never,
      stdin: stdin as never,
      debug: false,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return { stdout, instance };
};

describe("StaticChatContent", () => {
  it("prints the settled transcript on its own, away from the live frame", () => {
    const { stdout, instance } = renderTranscript(
      [item("user", "first question"), item("assistant", "second answer")],
      1,
    );

    try {
      const settledChunk = stdout.chunks.find((chunk) =>
        chunk.includes("first question"),
      );

      expect(settledChunk).toBeDefined();
      // The finished message is written on its own: it is not part of the
      // frame that gets redrawn while the answer streams.
      expect(settledChunk).not.toContain("second answer");
      expect(
        stdout.chunks.some((chunk) => chunk.includes("second answer")),
      ).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it("never reprints settled history when the live answer grows", () => {
    const settledQuestion = item("user", "first question");
    const { stdout, instance } = renderTranscript(
      [settledQuestion, item("assistant", "partial")],
      1,
    );

    try {
      const before = stdout.chunks.length;
      expect(
        stdout.chunks.filter((chunk) => chunk.includes("first question")),
      ).toHaveLength(1);

      instance.rerender(
        <StaticChatContent
          showIntroMessage={false}
          chatHistory={[
            settledQuestion,
            item("assistant", "partial answer that grew further"),
          ]}
          renderMessage={(message) => (
            <Text key={String(message.message.content)}>
              {String(message.message.content)}
            </Text>
          )}
          liveItemCount={1}
        />,
      );

      const printed = stdout.chunks.slice(before);
      expect(printed.join("")).toContain("partial answer that grew further");
      expect(printed.join("")).not.toContain("first question");
    } finally {
      instance.unmount();
    }
  });

  it("prints the banner ahead of the transcript", () => {
    const { stdout, instance } = renderTranscript(
      [item("user", "first question")],
      0,
      true,
    );

    try {
      const bannerChunk = stdout.chunks.find((chunk) => chunk.includes("██"));
      const written = stdout.chunks.join("");

      expect(bannerChunk).toBeDefined();
      expect(written.indexOf("██")).toBeLessThan(
        written.indexOf("first question"),
      );
    } finally {
      instance.unmount();
    }
  });
});
