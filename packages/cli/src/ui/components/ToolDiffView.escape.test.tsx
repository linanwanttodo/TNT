import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolDiffView } from "./ToolDiffView.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const DIFF = [
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1 +1 @@",
  `-const a = "1";`,
  `+const a = "2";`,
].join("\n");

describe("ToolDiffView terminal safety", () => {
  let view: ReturnType<typeof render> | undefined;

  afterEach(() => {
    view?.unmount();
    view = undefined;
  });

  function show(diffContent: string): string {
    view = render(<ToolDiffView diffContent={diffContent} expanded />);
    return view.lastFrame() ?? "";
  }

  it("does not pass a control sequence from a changed line through", () => {
    // Diff rows are file contents, so a line can carry an OSC of its own.
    const frame = show(DIFF.replace('"2"', `"2${ESC}]0;pwned${BEL}"`));

    expect(frame).not.toContain(`${ESC}]0;`);
    expect(frame).toContain("const a");
  });

  it("still renders the ordinary rows", () => {
    expect(show(DIFF)).toContain('const a = "1"');
  });
});
