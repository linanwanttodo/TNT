import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { ActionStatus } from "./ActionStatus.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

/**
 * Every call site passes a translated constant today, so nothing here is a
 * live hole: this is the boundary held shut in case a status ever carries
 * text from outside the process.
 */
describe("ActionStatus terminal safety", () => {
  it("does not pass a control sequence from the status message through", () => {
    const frame = frameOf(
      <ActionStatus
        visible
        startTime={Date.now()}
        message={`working${ESC}]0;pwned${BEL} on`}
      />,
    );

    expect(frame).not.toContain(`${ESC}]0;`);
    expect(frame).toContain("working");
    expect(frame).toContain("on");
  });

  it("does not pass a control sequence from the extra hint through", () => {
    const frame = frameOf(
      <ActionStatus
        visible
        startTime={Date.now()}
        message="working"
        additionalHint={`hint${ESC}]2;evil${BEL} tail`}
      />,
    );

    expect(frame).not.toContain(`${ESC}]2;`);
    expect(frame).toContain("tail");
  });
});
