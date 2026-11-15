import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  tencentDarkTheme,
  tencentLightTheme,
  ThemeProvider,
} from "../theme/tokens.js";

import {
  getDiffSummary,
  isDiffContent,
  parseDiffLines,
  separateDiffAndNotes,
  ToolDiffView,
} from "./ToolDiffView.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("ToolDiffView utilities", () => {
  it("detects unified diff content accurately", () => {
    expect(isDiffContent("@@ -1,3 +1,4 @@\n-old\n+new")).toBe(true);
    expect(
      isDiffContent(
        "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts",
      ),
    ).toBe(true);
    expect(isDiffContent("--- src/a.ts\n+++ src/a.ts\n@@ -1 +1 @@")).toBe(true);
    expect(isDiffContent("ordinary plain console text output")).toBe(false);
  });

  it("separates notes from diff body", () => {
    const raw =
      "Successfully edited src/index.ts\n--- src/index.ts\n+++ src/index.ts\n@@ -1,2 +1,2 @@\n-old\n+new";
    const { notes, diff } = separateDiffAndNotes(raw);

    expect(notes).toBe("Successfully edited src/index.ts");
    expect(diff).toContain("@@ -1,2 +1,2 @@");
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
  });

  it("parses diff lines and extracts hunk line numbers", () => {
    const sample = `--- a/file.ts
+++ b/file.ts
@@ -10,3 +10,4 @@
  context
-remove
+added1
+added2
  tail`;
    const lines = parseDiffLines(sample);
    const summary = getDiffSummary(lines);

    expect(summary.additions).toBe(2);
    expect(summary.deletions).toBe(1);

    const delLine = lines.find((l) => l.type === "del");
    expect(delLine?.oldLineNumber).toBe(11);
    expect(delLine?.content).toBe("remove");

    const addLine = lines.find((l) => l.type === "add");
    expect(addLine?.newLineNumber).toBe(11);
    expect(addLine?.content).toBe("added1");
  });
});

describe("ToolDiffView Component", () => {
  const sampleDiff = `@@ -1,5 +1,6 @@
 line1
-line2
+line2_modified
+line2_extra
 line3
 line4
 line5`;

  it("renders in collapsed state showing tail rows and earlier count", () => {
    const frame = frameOf(
      <ToolDiffView
        diffContent={sampleDiff}
        expanded={false}
        collapsedLines={3}
      />,
    );

    expect(frame).toContain("earlier lines, click to expand");
    expect(frame).toContain("line5");
    expect(frame).toContain("line4");
    expect(frame).not.toContain("line1");
  });

  it("renders in expanded state displaying full changes with diff markers", () => {
    const frame = frameOf(
      <ToolDiffView diffContent={sampleDiff} expanded={true} />,
    );

    expect(frame).toContain("+");
    expect(frame).toContain("-");
    expect(frame).toContain("line2_modified");
    expect(frame).toContain("line2");
    expect(frame).toContain("click to collapse");
  });

  it("renders with custom Tencent dark and light themes without crashing", () => {
    const darkFrame = frameOf(
      <ThemeProvider theme={tencentDarkTheme}>
        <ToolDiffView diffContent={sampleDiff} expanded={true} />
      </ThemeProvider>,
    );
    expect(darkFrame).toContain("line2_modified");

    const lightFrame = frameOf(
      <ThemeProvider theme={tencentLightTheme}>
        <ToolDiffView diffContent={sampleDiff} expanded={true} />
      </ThemeProvider>,
    );
    expect(lightFrame).toContain("line2_modified");
  });
});
