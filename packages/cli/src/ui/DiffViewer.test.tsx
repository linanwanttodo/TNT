import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViewer } from "./DiffViewer.js";
import {
  diffWindow,
  hunkDisplayRows,
  hunkRows,
  nextHunk,
} from "./diffViewport.js";

const mounted: { unmount: () => void }[] = [];
function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

/** A change with `count` added lines and a second hunk far down. */
function diffWith(count: number): string {
  const added = Array.from({ length: count }, (_, i) => `+row-${i + 1}`);
  return [
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1,1 +1,2 @@",
    "+first-hunk",
    " context",
    `@@ -${count},1 +${count},${count} @@`,
    ...added,
  ].join("\n");
}

describe("the diff viewport arithmetic", () => {
  it("keeps the window inside the rows it has", () => {
    expect(diffWindow(100, 0, 10)).toEqual({ offset: 0, end: 10 });
    expect(diffWindow(100, 95, 10)).toEqual({ offset: 90, end: 100 });
    expect(diffWindow(4, 40, 10)).toEqual({ offset: 0, end: 4 });
    // A window taller than the change still starts at the top.
    expect(diffWindow(0, 3, 10)).toEqual({ offset: 0, end: 0 });
  });

  it("counts hunk positions in the rows the viewer scrolls", () => {
    // Hunk headers and metadata are not rendered, so a hunk's position is the
    // number of displayable rows before it - not its index in the parsed list.
    expect(
      hunkDisplayRows([
        { type: "hunk" },
        { type: "add" },
        { type: "context" },
        { type: "hunk" },
        { type: "del" },
      ]),
    ).toEqual([0, 2]);
    expect(hunkRows([{ type: "hunk" }, { type: "add" }])).toEqual([0]);
  });

  it("jumps to the next and previous hunk, not to the current one", () => {
    const rows = hunkRows([
      { type: "hunk" },
      { type: "add" },
      { type: "hunk" },
      { type: "add" },
    ]);
    expect(rows).toEqual([0, 2]);
    expect(nextHunk(rows, 0, 1)).toBe(2);
    expect(nextHunk(rows, 1, 1)).toBe(2);
    expect(nextHunk(rows, 2, 1)).toBeUndefined();
    expect(nextHunk(rows, 2, -1)).toBe(0);
    expect(nextHunk(rows, 0, -1)).toBeUndefined();
  });
});

describe("the full-screen diff", () => {
  it("shows the file, the counts and where in the change the reader is", async () => {
    const { lastFrame } = track(
      <DiffViewer diffContent={diffWith(30)} onClose={vi.fn()} />,
    );
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("file.ts");
    expect(frame).toContain("+31");
    expect(frame).toContain("hunk 1/2");
    expect(frame).toContain("lines 1-");
  });

  it("scrolls the window instead of clipping the change", async () => {
    const onClose = vi.fn();
    const { lastFrame, stdin } = track(
      <DiffViewer diffContent={diffWith(200)} onClose={onClose} />,
    );
    await settle();
    const before = lastFrame() ?? "";
    expect(before).not.toContain("row-200");

    stdin.write("\u001b[6~"); // PageDown
    await settle();
    stdin.write("\u001b[6~");
    await settle();
    stdin.write("\u001b[6~");
    await settle();

    expect(lastFrame()).not.toBe(before);

    stdin.write("\u001b");
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it("jumps between hunks with n and p", async () => {
    const { lastFrame, stdin } = track(
      <DiffViewer diffContent={diffWith(200)} onClose={vi.fn()} />,
    );
    await settle();

    stdin.write("n");
    await settle();

    expect(lastFrame()).toContain("hunk 2/2");
  });

  it("wraps a line too long for the terminal and keeps its tail", async () => {
    // Ink wraps at the terminal width; the claim here is that the change is not
    // silently cut at the edge - the tail of a long line is on a later row.
    const long = "x".repeat(240);
    const tree = track(
      <DiffViewer
        diffContent={[
          "--- a/f.ts",
          "+++ b/f.ts",
          "@@ -1,1 +1,1 @@",
          `+${long}`,
        ].join("\n")}
        onClose={vi.fn()}
      />,
    );
    await settle();

    const frame = tree.lastFrame() ?? "";
    const rows = frame.split("\n");
    const widths = rows.map((row) => row.length);
    expect(Math.max(...widths)).toBeLessThanOrEqual(100);
    // 240 chars cannot fit on one 100-column row, so the tail exists elsewhere.
    expect(
      rows.filter((row) => row.includes("xxxxxxxxxx")).length,
    ).toBeGreaterThan(1);
  });
});
