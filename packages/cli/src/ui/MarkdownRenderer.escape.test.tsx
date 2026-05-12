import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/**
 * The claim is about the bytes the terminal receives, so it is checked on a
 * rendered frame rather than on the sanitizer's return value.
 */
describe("MarkdownRenderer terminal safety", () => {
  let view: ReturnType<typeof render> | undefined;

  afterEach(() => {
    // The UI suite is balanced on unmounting: a tree left mounted keeps Ink's
    // frame loop alive for every later file.
    view?.unmount();
    view = undefined;
  });

  function show(content: string): string {
    view = render(<MarkdownRenderer content={content} />);
    return view.lastFrame() ?? "";
  }

  it("does not pass an OSC title change through to the terminal", () => {
    const frame = show(`done ${ESC}]0;pwned${BEL} more`);

    expect(frame).not.toContain(`${ESC}]0;`);
    expect(frame).toContain("done");
    expect(frame).toContain("more");
  });

  it("keeps SGR colour that a tool printed on purpose", () => {
    expect(show(`x${ESC}[31mfailed${ESC}[39m`)).toContain(`${ESC}[31m`);
  });
});
