import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { CompactionBoundary } from "./CompactionBoundary.js";
import { MemoizedMessage } from "./MemoizedMessage.js";

describe("CompactionBoundary", () => {
  it("labels the boundary and shows the summary", () => {
    const { lastFrame } = render(
      <CompactionBoundary summary="## recap\n\n- kept the parser change" />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("context compacted");
    expect(frame).toContain("recap");
    expect(frame).toContain("kept the parser change");
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

  it("renders the compaction summary instead of a bare rule", () => {
    const { lastFrame } = render(<MemoizedMessage item={item} index={1} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("context compacted");
    expect(frame).toContain(summary);
  });
});
