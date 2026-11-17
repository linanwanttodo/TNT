import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { CompactionBoundary } from "./CompactionBoundary.js";
import { MemoizedMessage } from "./MemoizedMessage.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("CompactionBoundary", () => {
  it("labels the boundary and keeps the summary out of the transcript", () => {
    const frame = frameOf(<CompactionBoundary />);

    expect(frame).toContain("context compacted");
    expect(frame).not.toContain("recap");
  });
});

describe("MemoizedMessage compaction item", () => {
  const summary = "older turns were replaced by this summary";

  const item: ChatHistoryItem = {
    message: { role: "assistant", content: summary },
    contextItems: [],
    conversationSummary: summary,
    compactionCheckpoint: {
      kind: "compact-checkpoint",
      compactionId: "test-checkpoint",
    },
  };

  it("renders only the boundary rule, never the summary body", () => {
    const frame = frameOf(<MemoizedMessage item={item} index={1} />);

    expect(frame).toContain("context compacted");
    expect(frame).not.toContain(summary);
  });
});
