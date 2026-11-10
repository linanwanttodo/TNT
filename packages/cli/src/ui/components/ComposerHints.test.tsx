import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  ComposerHints,
  composerHintText,
  selectComposerHint,
} from "./ComposerHints.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("selectComposerHint", () => {
  it("lets an interruption replace every other hint", () => {
    const hint = selectComposerHint({
      wasInterrupted: true,
      queuedCount: 2,
      working: true,
    });

    expect(hint).toEqual({ kind: "interrupted" });
  });

  it("lets a queued message replace the running hint", () => {
    const hint = selectComposerHint({
      wasInterrupted: false,
      queuedCount: 2,
      working: true,
    });

    expect(hint).toEqual({ kind: "queued", count: 2 });
  });

  it("falls back from working to nothing", () => {
    expect(
      selectComposerHint({
        wasInterrupted: false,
        queuedCount: 0,
        working: true,
      }),
    ).toEqual({ kind: "working" });
    // Idle renders nothing: command discovery lives in the "/" slash menu,
    // and the allocated hints row carries no occupancy filler.
    expect(
      selectComposerHint({
        wasInterrupted: false,
        queuedCount: 0,
        working: false,
      }),
    ).toBeNull();
  });

  it("has no text for a missing hint", () => {
    expect(composerHintText(null)).toBeNull();
  });
});

describe("ComposerHints", () => {
  it("draws exactly one transient hint", () => {
    const frame = frameOf(
      <ComposerHints wasInterrupted queuedCount={2} working />,
    );

    expect(frame).toContain("Interrupted by user");
    expect(frame).not.toContain("queued");
    expect(frame).not.toContain("esc to interrupt");
    expect(frame).not.toContain("/help");
  });

  it("draws the queue controls instead of the interrupt hint", () => {
    const frame = frameOf(
      <ComposerHints wasInterrupted={false} queuedCount={2} working />,
    );

    expect(frame).toContain("2 queued");
    expect(frame).toContain("ctrl+x remove");
    expect(frame).toContain("ctrl+r edit");
    expect(frame).not.toContain("esc to interrupt");
    expect(frame).not.toContain("/help");
  });

  it("draws the interrupt hint while a turn runs", () => {
    const frame = frameOf(
      <ComposerHints wasInterrupted={false} queuedCount={0} working />,
    );

    expect(frame).toContain("esc to interrupt");
    expect(frame).not.toContain("/help");
  });

  it("leaves the hints row blank when idle", () => {
    const frame = frameOf(
      <ComposerHints wasInterrupted={false} queuedCount={0} working={false} />,
    );

    // The row stays allocated so a transient hint cannot move the input, but
    // idle carries no occupancy filler.
    expect(frame).not.toContain("/help");
    expect(frame.trim()).toBe("");
  });
});
