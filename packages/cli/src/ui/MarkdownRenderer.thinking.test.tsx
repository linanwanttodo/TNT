import { render } from "ink-testing-library";
import React from "react";

import { MarkdownRenderer } from "./MarkdownRenderer.js";

describe("MarkdownRenderer - thinking tags", () => {
  it("handles multiple thinking tags", () => {
    const content =
      "Text <think>First thought</think> middle <think>Second thought</think> end";
    const tree = render(<MarkdownRenderer content={content} />);
    const frame = tree.lastFrame();
    tree.unmount();

    expect(frame).toContain("First thought");
    expect(frame).toContain("Second thought");
  });

  it("handles thinking tags with multiline content", () => {
    const content = `<think>
    This is a multiline
    thinking block
    </think>`;
    const tree = render(<MarkdownRenderer content={content} />);
    const frame = tree.lastFrame();
    tree.unmount();

    expect(frame).toContain("This is a multiline");
    expect(frame).toContain("thinking block");
  });

  it("ignores thinking tags inside code blocks", () => {
    const content = "```\n<think>This should not be processed</think>\n```";
    const tree = render(<MarkdownRenderer content={content} />);
    const frame = tree.lastFrame();
    tree.unmount();

    // The thinking tag should appear as literal text within the code block
    expect(frame).toContain("<think>This should not be processed</think>");
  });
});
