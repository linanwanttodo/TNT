import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import type { QueuedMessage } from "../../stream/messageQueue.js";

import { QueuedMessages } from "./QueuedMessages.js";

function message(id: string, text: string): QueuedMessage {
  return { id, message: text, timestamp: 0 };
}

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("QueuedMessages", () => {
  it("renders nothing when the queue is empty", () => {
    expect(frameOf(<QueuedMessages messages={[]} />)).toBe("");
  });

  it("renders one row per queued message in order", () => {
    const frame = frameOf(
      <QueuedMessages
        messages={[message("a", "first"), message("b", "second")]}
      />,
    );

    expect(frame).toContain("[queued] first");
    expect(frame).toContain("[queued] second");
    expect(frame.indexOf("first")).toBeLessThan(frame.indexOf("second"));
  });

  it("puts the shortcut hint only on the newest row", () => {
    const frame = frameOf(
      <QueuedMessages
        messages={[message("a", "first"), message("b", "second")]}
      />,
    );

    expect(frame.match(/ctrl\+x remove/g)).toHaveLength(1);
    expect(frame).toContain("ctrl+r edit");
  });

  it("flattens a multi-line message into one row", () => {
    const frame = frameOf(
      <QueuedMessages messages={[message("a", "one\ntwo")]} />,
    );

    expect(frame).toContain("[queued] one two");
  });
});
