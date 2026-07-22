import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (frame: string) => frame.replace(ANSI, "");

describe("MarkdownRenderer tables", () => {
  it("renders a pipe table as an aligned grid with a header rule", () => {
    const content = [
      "| 文件 | 大小 | 内容猜测 |",
      "|---|---|---|",
      "| 实验1熟悉实验环境.docx | 3.2MB | 实验一相关材料 |",
      "| 实验一报告.md | 13KB | 同上报告的 Markdown 版 |",
    ].join("\n");

    const { lastFrame, unmount } = render(
      React.createElement(MarkdownRenderer, { content }),
    );
    const frame = plain(lastFrame() ?? "");
    unmount();

    expect(frame).toContain("┌");
    expect(frame).toContain("│ 文件");
    expect(frame).toContain("实验1熟悉实验环境.docx");
    expect(frame).toContain("3.2MB");
    expect(frame).toContain("└");
    // The delimiter row never leaks as literal dashes.
    expect(frame).not.toMatch(/\|---/);
  });

  it("keeps inline patterns out of the table cells", () => {
    const content = [
      "| 名字 | 备注 |",
      "|---|---|",
      "| **粗体** | `code` |",
    ].join("\n");

    const { lastFrame, unmount } = render(
      React.createElement(MarkdownRenderer, { content }),
    );
    expect(plain(lastFrame() ?? "")).toContain("**粗体**");
    unmount();
  });

  it("leaves ordinary prose untouched", () => {
    const { lastFrame, unmount } = render(
      React.createElement(MarkdownRenderer, { content: "hello | world" }),
    );
    expect(plain(lastFrame() ?? "")).toContain("hello | world");
    expect(plain(lastFrame() ?? "")).not.toContain("┌");
    unmount();
  });
});
