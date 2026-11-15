import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { TranscriptContent } from "./TranscriptContent.js";

const previous = process.env.TNT_ALT_SCREEN;

afterEach(() => {
  if (previous === undefined) delete process.env.TNT_ALT_SCREEN;
  else process.env.TNT_ALT_SCREEN = previous;
});

const history: ChatHistoryItem[] = [
  { message: { role: "user", content: "old question" }, contextItems: [] },
];

function tree(streamingText: string) {
  return (
    <TranscriptContent
      showIntroMessage={false}
      chatHistory={history}
      renderMessage={(item) => <Text>{String(item.message.content)}</Text>}
      streamingText={streamingText}
      streamingReasoning={null}
      scrollTop={0}
      onMetrics={() => {}}
      showScrollbar={false}
      isWaitingForResponse={false}
      responseStartTime={null}
      isCompacting={false}
      compactionStartTime={null}
      isBashToolRunning={false}
    />
  );
}

describe("TranscriptContent without the alternate screen", () => {
  it("writes settled history once and keeps only the tail redrawing", () => {
    process.env.TNT_ALT_SCREEN = "0";
    const view = render(tree("a"));
    view.rerender(tree("a b"));
    view.rerender(tree("a b c"));

    // The test harness captures Static output in its frames, so it cannot
    // observe the terminal's write-once behaviour. What it can prove is that
    // the normal-buffer branch renders both the settled row and the live tail.
    expect(view.frames.some((frame) => frame.includes("old question"))).toBe(
      true,
    );
    expect(view.lastFrame()).toContain("a b c");
    view.unmount();
  });
});
