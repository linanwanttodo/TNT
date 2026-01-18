import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ToolCallState } from "../../../../../core/index.js";
import {
  tencentDarkTheme,
  tencentLightTheme,
  ThemeProvider,
} from "../theme/tokens.js";
import { clearClickRegions, dispatchClick } from "../utils/clickRegions.js";

import { ToolGroupDisplay, ToolItemDisplay } from "./ToolGroupDisplay.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

afterEach(() => {
  clearClickRegions();
});

function mockToolState(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolCallId: "call-1",
    toolCall: {
      id: "call-1",
      type: "function",
      function: { name: "Bash", arguments: '{"command":"echo test"}' },
    },
    status: "done",
    parsedArgs: { command: "echo test" },
    output: [
      {
        id: "out-1",
        name: "Bash Output",
        description: "",
        content: "test output",
      } as never,
    ],
    ...overrides,
  } as ToolCallState;
}

describe("ToolItemDisplay", () => {
  it("renders a completed call as a check, the name, and its subject", () => {
    const state = mockToolState({ status: "done" });
    const frame = frameOf(<ToolItemDisplay toolState={state} isFirst={true} />);

    const firstLine =
      frame.split("\n").find((line) => line.trim() !== "") ?? "";
    expect(firstLine).toMatch(/╭─ ✓ /);
    expect(firstLine).toContain("$ echo test");
  });

  it("renders a running call with the executing marker", () => {
    const state = mockToolState({ status: "calling" });
    const frame = frameOf(<ToolItemDisplay toolState={state} isFirst={true} />);

    const firstLine =
      frame.split("\n").find((line) => line.trim() !== "") ?? "";
    expect(firstLine).toMatch(/╭─ ⊷ /);
  });

  it("renders a pending call with the pending marker", () => {
    const state = mockToolState({ status: "generated" });
    const frame = frameOf(<ToolItemDisplay toolState={state} />);

    const firstLine =
      frame.split("\n").find((line) => line.trim() !== "") ?? "";
    expect(firstLine).toMatch(/╭─ o /);
  });

  it("renders an errored call with its message", () => {
    const state = mockToolState({
      status: "errored",
      output: [
        {
          id: "err-1",
          name: "Error",
          description: "",
          content: "command not found",
        } as never,
      ],
    });
    const frame = frameOf(<ToolItemDisplay toolState={state} isFirst={true} />);

    const firstLine =
      frame.split("\n").find((line) => line.trim() !== "") ?? "";
    expect(firstLine).toMatch(/╭─ x /);
    expect(frame).toContain("command not found");
  });

  it("appends how much work a finished read produced", () => {
    const state = mockToolState({
      status: "done",
      toolCall: {
        id: "call-read",
        type: "function",
        function: { name: "Read", arguments: '{"path":"src/a.ts"}' },
      },
      parsedArgs: { path: "src/a.ts" },
      output: [
        {
          id: "out-read",
          name: "Read",
          description: "",
          content: "line one\nline two\nline three",
        } as never,
      ],
    });

    const frame = frameOf(<ToolItemDisplay toolState={state} />);
    expect(frame).toContain("Read");
    expect(frame).toContain("src/a.ts");
    expect(frame).toContain("· 3 lines");
  });

  it("keeps the tail of the output and says how many rows are folded", () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `output-line-${index + 1}`,
    ).join("\n");
    const frame = frameOf(
      <ToolItemDisplay
        toolState={mockToolState({
          status: "done",
          output: [
            {
              id: "out",
              name: "Bash",
              description: "",
              content: output,
            } as never,
          ],
        })}
      />,
    );

    expect(frame).toContain("output-line-10");
    expect(frame).toContain("output-line-7");
    expect(frame).not.toContain("output-line-1\n");
    expect(frame).toContain("... (6 earlier lines, click to expand)");
  });

  it("expands the folded output when the panel is clicked", async () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `output-line-${index + 1}`,
    ).join("\n");
    const tree = render(
      <ToolItemDisplay
        toolState={mockToolState({
          status: "done",
          output: [
            {
              id: "out",
              name: "Bash",
              description: "",
              content: output,
            } as never,
          ],
        })}
      />,
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const findHeaderRow = (): number =>
        (tree.lastFrame() ?? "")
          .split("\n")
          .findIndex((line) => line.includes("$ echo test")) + 1;

      // The first paints may land before Ink commits the layout the click
      // regions measure against; retry briefly instead of racing one sleep.
      let handled = false;
      for (let attempt = 0; attempt < 25 && !handled; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        handled = dispatchClick(findHeaderRow(), 2);
      }
      expect(handled).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("output-line-1");
      expect(frame).toContain("click to collapse");
    } finally {
      tree.unmount();
    }
  });

  it("folds the output again when the call finishes", async () => {
    const output = Array.from(
      { length: 10 },
      (_, index) => `output-line-${index + 1}`,
    ).join("\n");
    const running = mockToolState({
      status: "calling",
      output: [
        { id: "out", name: "Bash", description: "", content: output } as never,
      ],
    });
    const done = { ...running, status: "done" as const };

    const tree = render(<ToolItemDisplay toolState={running} />);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("output-line-1");

      tree.rerender(<ToolItemDisplay toolState={done} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("output-line-10");
      expect(frame).toContain("earlier lines, click to expand");
      expect(frame).not.toContain("output-line-1\n");
    } finally {
      tree.unmount();
    }
  });

  it("folds a finished diff without dropping the change count", async () => {
    const diffText = [
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -1,4 +1,4 @@",
      " function add(a, b) {",
      "-  return a - b;",
      "+  return a + b;",
      " }",
      " ",
    ].join("\n");

    const running = mockToolState({
      status: "calling",
      toolCall: {
        id: "call-edit",
        type: "function",
        function: { name: "Edit", arguments: '{"file_path":"src/math.ts"}' },
      },
      parsedArgs: { file_path: "src/math.ts" },
      output: [
        {
          id: "out",
          name: "Edit",
          description: "",
          content: diffText,
        } as never,
      ],
    });
    const done = { ...running, status: "done" as const };

    const tree = render(<ToolItemDisplay toolState={running} />);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tree.lastFrame() ?? "").toContain("return a + b;");

      tree.rerender(<ToolItemDisplay toolState={done} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("· +1 -1");
      expect(frame).toContain("click to expand");
    } finally {
      tree.unmount();
    }
  });

  it("uses no emoji in a finished tool panel", () => {
    const state = mockToolState({ status: "done" });
    const frame = frameOf(<ToolItemDisplay toolState={state} />);

    expect(frame).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(frame).not.toContain("\uFE0F");
  });
});

describe("ToolGroupDisplay", () => {
  it("renders empty when states array is empty", () => {
    const frame = frameOf(<ToolGroupDisplay toolStates={[]} />);
    expect(frame).toBe("");
  });

  it("renders multiple tool calls in sequence", () => {
    const toolStates: ToolCallState[] = [
      mockToolState({
        toolCallId: "call-1",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "ReadFile", arguments: '{"path":"a.ts"}' },
        },
      }),
      mockToolState({
        toolCallId: "call-2",
        toolCall: {
          id: "call-2",
          type: "function",
          function: { name: "WriteFile", arguments: '{"path":"b.ts"}' },
        },
      }),
    ];

    const frame = frameOf(<ToolGroupDisplay toolStates={toolStates} />);
    expect(frame).toContain("ReadFile");
    expect(frame).toContain("WriteFile");
  });

  it("separates consecutive panels with a blank row and a frame each", () => {
    const toolStates: ToolCallState[] = [
      mockToolState({ toolCallId: "call-1" }),
      mockToolState({ toolCallId: "call-2" }),
      mockToolState({ toolCallId: "call-3" }),
    ];

    const lines = frameOf(<ToolGroupDisplay toolStates={toolStates} />).split(
      "\n",
    );

    expect(lines.filter((line) => line.includes("✓"))).toHaveLength(3);
    // Each call draws its own rounded frame with the title in the top bar.
    expect(lines.filter((line) => line.includes("╭─"))).toHaveLength(3);
    expect(lines.filter((line) => line.includes("╰"))).toHaveLength(3);
    // Each panel opens with its own blank row before its frame.
    expect(
      lines.filter((line) => line.trim() === "").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("renders diff output with dedicated diff view and addition/deletion summary", () => {
    const diffText = `--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,4 @@
 function add(a, b) {
-  return a - b;
+  // correct logic
+  return a + b;
 }`;
    const state = mockToolState({
      status: "done",
      toolCall: {
        id: "call-edit",
        type: "function",
        function: {
          name: "Edit",
          arguments: '{"file_path":"src/math.ts"}',
        },
      },
      parsedArgs: { file_path: "src/math.ts" },
      output: [
        {
          id: "out-diff",
          name: "Edit",
          description: "",
          content: diffText,
        } as never,
      ],
    });

    const frame = frameOf(<ToolItemDisplay toolState={state} />);
    expect(frame).toContain("✓");
    expect(frame).toContain("Edit");
    expect(frame).toContain("src/math.ts");
    expect(frame).toContain("· +2 -1");
    expect(frame).toContain("return a + b;");
  });

  it("renders diff correctly within Tencent theme provider", () => {
    const diffText = `@@ -1,2 +1,2 @@
-hello
+hello world`;
    const state = mockToolState({
      status: "done",
      toolCall: {
        id: "call-write",
        type: "function",
        function: {
          name: "Write",
          arguments: '{"filepath":"src/index.ts"}',
        },
      },
      parsedArgs: { filepath: "src/index.ts" },
      output: [
        {
          id: "out-write",
          name: "Write",
          description: "",
          content: diffText,
        } as never,
      ],
    });

    const frameDark = frameOf(
      <ThemeProvider theme={tencentDarkTheme}>
        <ToolItemDisplay toolState={state} />
      </ThemeProvider>,
    );
    expect(frameDark).toContain("hello world");

    const frameLight = frameOf(
      <ThemeProvider theme={tencentLightTheme}>
        <ToolItemDisplay toolState={state} />
      </ThemeProvider>,
    );
    expect(frameLight).toContain("hello world");
  });
});
