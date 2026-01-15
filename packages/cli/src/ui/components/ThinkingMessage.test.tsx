import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { setLocale } from "../../i18n/index.js";
import {
  resetReasoningFold,
  toggleReasoningExpanded,
} from "../reasoningFold.js";
import { clearClickRegions, dispatchClick } from "../utils/clickRegions.js";

import { MemoizedMessage } from "./MemoizedMessage.js";
import { ThinkingMessage } from "./ThinkingMessage.js";

afterEach(() => {
  resetReasoningFold();
  clearClickRegions();
  setLocale("en");
});

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("ThinkingMessage", () => {
  it("renders every thought line in one muted style while streaming", () => {
    const thought =
      "Analyzing user requirements\nChecking package dependencies\nFinalizing plan";
    const frame = frameOf(<ThinkingMessage thought={thought} isStreaming />);

    expect(frame).toContain("Analyzing user requirements");
    expect(frame).toContain("Checking package dependencies");
    expect(frame).toContain("Finalizing plan");
    // The visible thought has no label or rules of its own.
    expect(frame).not.toContain("Thinking...");
    expect(frame).not.toContain("│");
  });

  it("handles empty thoughts gracefully", () => {
    const frame = frameOf(<ThinkingMessage thought="" />);
    expect(frame).toBe("");
  });

  it("keeps a streaming thought readable", () => {
    const frame = frameOf(
      <ThinkingMessage thought="Processing" isStreaming={true} />,
    );
    expect(frame).toContain("Processing");
  });

  it("draws the block without a border", () => {
    const frame = frameOf(<ThinkingMessage thought={"one\ntwo"} isStreaming />);
    expect(frame).not.toContain("│");
  });

  it("keeps paragraph breaks between thought runs", () => {
    const frame = frameOf(
      <ThinkingMessage
        thought={"first paragraph\n\n\nsecond paragraph"}
        isStreaming
      />,
    );
    const lines = frame.split("\n");

    expect(lines).toContain("first paragraph");
    expect(lines).toContain("second paragraph");
    // Three blank rows collapse to one, so the thought keeps its structure
    // without turning into a column of gaps.
    expect(lines.filter((line) => line.trim() === "")).toHaveLength(1);
  });

  it("folds a finished block and toggles it on click", async () => {
    const tree = render(<ThinkingMessage thought={"one line\ntwo line"} />);

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("Thinking...");
      expect(tree.lastFrame() ?? "").not.toContain("one line");

      expect(dispatchClick(1, 2)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("one line");

      expect(dispatchClick(1, 2)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("Thinking...");
      expect(tree.lastFrame() ?? "").not.toContain("one line");
    } finally {
      tree.unmount();
    }
  });

  it("folds the live block once streaming ends", async () => {
    const tree = render(
      <ThinkingMessage thought={"live thought"} isStreaming />,
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("live thought");

      tree.rerender(<ThinkingMessage thought={"live thought"} />);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("Thinking...");
      expect(tree.lastFrame() ?? "").not.toContain("live thought");
    } finally {
      tree.unmount();
    }
  });

  it("expands and folds every finished block on Ctrl+O", () => {
    const thought = "first line\nsecond line";
    toggleReasoningExpanded();

    const frame = frameOf(<ThinkingMessage thought={thought} />);
    expect(frame).toContain("first line");
    expect(frame).not.toContain("Thinking...");

    toggleReasoningExpanded();

    const folded = frameOf(<ThinkingMessage thought={thought} />);
    expect(folded).toContain("Thinking...");
    expect(folded).not.toContain("first line");
  });

  it("translates the folded label with the active locale", () => {
    setLocale("zh-CN");

    const frame = frameOf(<ThinkingMessage thought={"first line"} />);

    expect(frame).toContain("思考中…");
    expect(frame).not.toContain("Thinking...");
  });
});

describe("MemoizedMessage with think tags", () => {
  it("extracts think tag and renders thought when reasoning is expanded", () => {
    toggleReasoningExpanded();
    const item: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: "<think>Step 1: check files</think>Here is the final answer.",
      },
      contextItems: [],
    };

    const frame = frameOf(<MemoizedMessage item={item} index={1} />);
    expect(frame).toContain("Step 1: check files");
    expect(frame).toContain("Here is the final answer.");
    expect(frame).not.toContain("<think>");
    expect(frame).not.toContain("</think>");
  });

  it("folds an unclosed think block instead of showing the raw tag", () => {
    const item: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: "<think>Ongoing reasoning stream",
      },
      contextItems: [],
    };

    const frame = frameOf(<MemoizedMessage item={item} index={1} />);
    expect(frame).toContain("Thinking...");
    expect(frame).not.toContain("Ongoing reasoning stream");
    expect(frame).not.toContain("<think>");
  });
});
