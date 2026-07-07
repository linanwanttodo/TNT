import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ToolCallState } from "../../../../../core/index.js";
import { BLINK_INTERVAL_MS, blinkVisibleAt } from "../hooks/useBlink.js";
import { claudeFilledDot } from "../symbols.js";
import {
  darkTheme,
  tencentDarkTheme,
  tencentLightTheme,
  ThemeProvider,
} from "../theme/tokens.js";
import { clearClickRegions, dispatchClick } from "../utils/clickRegions.js";

import {
  ToolGroupDisplay,
  ToolItemDisplay,
  toolDotGlyph,
  toolDotIsLive,
  toolDotStyle,
} from "./ToolGroupDisplay.js";
import { ToolResultBlock } from "./ToolResultBlock.js";

const DOT = claudeFilledDot();

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

function nonEmptyLines(frame: string): string[] {
  return frame.split("\n").filter((line) => line.trim() !== "");
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

describe("the tool dot state machine", () => {
  it("maps every status to the same Claude dot and its own colour", () => {
    expect(toolDotStyle("generated", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.text.subtle,
      dim: true,
    });
    expect(toolDotStyle("generating", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.text.subtle,
      dim: true,
    });
    expect(toolDotStyle("calling", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.claude,
      dim: false,
    });
    expect(toolDotStyle("done", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.status.success,
      dim: false,
    });
    expect(toolDotStyle("errored", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.status.error,
      dim: false,
    });
    expect(toolDotStyle("canceled", darkTheme)).toEqual({
      glyph: DOT,
      color: darkTheme.text.subtle,
      dim: true,
    });
  });

  it("animates only a call that is executing", () => {
    expect(toolDotIsLive("calling")).toBe(true);
    expect(toolDotIsLive("generated")).toBe(false);
    expect(toolDotIsLive("done")).toBe(false);
    expect(toolDotIsLive("errored")).toBe(false);
    expect(toolDotIsLive("canceled")).toBe(false);
  });

  it("blinks the running dot to a space every 600 ms", () => {
    expect(BLINK_INTERVAL_MS).toBe(600);
    expect(blinkVisibleAt(0)).toBe(true);
    expect(blinkVisibleAt(599)).toBe(true);
    expect(blinkVisibleAt(600)).toBe(false);
    expect(blinkVisibleAt(1199)).toBe(false);
    expect(blinkVisibleAt(1200)).toBe(true);

    const style = toolDotStyle("calling", darkTheme);
    expect(toolDotGlyph(style, true)).toBe(DOT);
    expect(toolDotGlyph(style, false)).toBe(" ");
  });
});

describe("ToolItemDisplay", () => {
  it("renders a completed call as a dot, the name, and its subject", () => {
    const state = mockToolState({ status: "done" });
    const frame = frameOf(<ToolItemDisplay toolState={state} isFirst={true} />);

    const firstLine = nonEmptyLines(frame)[0] ?? "";
    expect(firstLine.startsWith(`${DOT} $ echo test`)).toBe(true);
  });

  it("renders a running call with the blinking dot", () => {
    const state = mockToolState({ status: "calling" });
    const frame = frameOf(<ToolItemDisplay toolState={state} isFirst={true} />);

    const firstLine = nonEmptyLines(frame)[0] ?? "";
    expect(firstLine.startsWith(`${DOT} $ echo test`)).toBe(true);
  });

  it("renders a queued call with the dim dot", () => {
    const state = mockToolState({ status: "generated" });
    const frame = frameOf(<ToolItemDisplay toolState={state} />);

    const firstLine = nonEmptyLines(frame)[0] ?? "";
    expect(firstLine.startsWith(`${DOT} $ echo test`)).toBe(true);
    expect(toolDotStyle(state.status, darkTheme).dim).toBe(true);
  });

  it("renders a cancelled call with the dim dot", () => {
    const state = mockToolState({ status: "canceled" });
    const frame = frameOf(<ToolItemDisplay toolState={state} />);

    const firstLine = nonEmptyLines(frame)[0] ?? "";
    expect(firstLine.startsWith(`${DOT} $ echo test`)).toBe(true);
    expect(toolDotStyle(state.status, darkTheme).dim).toBe(true);
  });

  it("renders an errored call with its message under the gutter", () => {
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

    const firstLine = nonEmptyLines(frame)[0] ?? "";
    expect(firstLine.startsWith(`${DOT} $ echo test`)).toBe(true);
    expect(frame).toContain("command not found");
    expect(frame).toContain("⎿ command not found");
  });

  it("draws the old per-state glyphs nowhere", () => {
    for (const status of ["generated", "calling", "done", "errored"] as const) {
      const frame = frameOf(
        <ToolItemDisplay toolState={mockToolState({ status })} />,
      );
      expect(frame).not.toContain("✓");
      expect(frame).not.toContain("⊗");
      expect(frame).not.toContain("✗");
    }
  });

  it("hangs a result below the call behind exactly one gutter", () => {
    const state = mockToolState({
      status: "done",
      output: [
        {
          id: "out",
          name: "Bash",
          description: "",
          content: "line one\nline two\nline three",
        } as never,
      ],
    });

    const resultLines = frameOf(<ToolItemDisplay toolState={state} />)
      .split("\n")
      .filter((line) => /line (one|two|three)/.test(line));

    expect(resultLines).toHaveLength(3);
    expect(resultLines.filter((line) => line.includes("⎿"))).toHaveLength(1);
    expect(resultLines[0]).toMatch(/^ {2}⎿ /);
    for (const line of resultLines.slice(1)) {
      expect(line.startsWith("    ")).toBe(true);
    }
  });

  it("does not repeat the gutter for a nested result", () => {
    const frame = frameOf(
      <ToolResultBlock>
        <Text>outer result</Text>
        <ToolResultBlock>
          <Text>inner result</Text>
        </ToolResultBlock>
      </ToolResultBlock>,
    );

    expect(frame.match(/⎿/g) ?? []).toHaveLength(1);
    expect(frame).toContain("outer result");
    expect(frame).toContain("inner result");
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

    // The leading dot is Claude Code's tool marker (U+23FA), not an emoji;
    // strip it before checking that no decorative pictograph slipped in.
    expect(frame.replaceAll("⏺", "")).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(frame).not.toContain("️");
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

  it("aligns every call's text in the same column", () => {
    const toolStates: ToolCallState[] = [
      mockToolState({
        toolCallId: "call-1",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "ReadFile", arguments: '{"path":"a.ts"}' },
        },
        parsedArgs: { path: "a.ts" },
      }),
      mockToolState({
        toolCallId: "call-2",
        status: "generated",
        toolCall: {
          id: "call-2",
          type: "function",
          function: { name: "WriteFile", arguments: '{"path":"b.ts"}' },
        },
        parsedArgs: { path: "b.ts" },
      }),
    ];

    const lines = frameOf(<ToolGroupDisplay toolStates={toolStates} />).split(
      "\n",
    );
    const first = lines.find((line) => line.includes("ReadFile")) ?? "";
    const second = lines.find((line) => line.includes("WriteFile")) ?? "";

    expect(first.indexOf("ReadFile")).toBe(2);
    expect(second.indexOf("WriteFile")).toBe(2);
  });

  it("separates consecutive calls with a blank row and one dot each", () => {
    const toolStates: ToolCallState[] = [
      mockToolState({ toolCallId: "call-1" }),
      mockToolState({ toolCallId: "call-2" }),
      mockToolState({ toolCallId: "call-3" }),
    ];

    const lines = frameOf(<ToolGroupDisplay toolStates={toolStates} />).split(
      "\n",
    );

    expect(lines.filter((line) => line.includes(DOT))).toHaveLength(3);
    // Each call opens with its own blank row before its dot.
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
    expect(frame).toContain(DOT);
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

describe("ToolGroupDisplay terminal safety", () => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);

  it("does not pass a control sequence from tool output through", () => {
    const frame = frameOf(
      <ToolGroupDisplay
        toolStates={[
          mockToolState({
            output: [
              {
                id: "out-1",
                name: "Bash Output",
                description: "",
                content: `ran ok${ESC}]0;pwned${BEL} tail`,
              } as never,
            ],
          }),
        ]}
      />,
    );

    expect(frame).not.toContain(`${ESC}]0;`);
    expect(frame).toContain("ran ok");
    expect(frame).toContain("tail");
  });

  it("does not pass a control sequence from the call arguments through", () => {
    const frame = frameOf(
      <ToolGroupDisplay
        toolStates={[
          mockToolState({
            parsedArgs: { command: `echo ${ESC}[?1049h done` },
          }),
        ]}
      />,
    );

    expect(frame).not.toContain(`${ESC}[?1049`);
    expect(frame).toContain("done");
  });
});
