import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserInput } from "./UserInput.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => []),
}));

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a condition with a ceiling. A fixed sleep between a keystroke and an
 * assertion is a race with the scheduler, and the Windows lane loses it: the
 * frame still read `history search "" · 0/0` after the query had been written,
 * because the input had not been applied yet. Bounded, so a genuinely broken
 * behaviour still fails rather than hanging.
 */
async function until(want: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!want() && Date.now() < deadline) {
    await tick(25);
  }
}

async function untilFrame(
  tree: ReturnType<typeof render>,
  want: (frame: string) => boolean,
): Promise<string> {
  await until(() => want(tree.lastFrame() ?? ""));
  return tree.lastFrame() ?? "";
}

/**
 * Ctrl+F searches the input history in place: a muted hint line above the
 * composer carries the query and the position, typing filters, repeated
 * Ctrl+F walks older matches, Esc restores what the box held before the
 * search opened, and Enter keeps the selection without submitting it.
 *
 * Ctrl+R is taken by the queued-message recall (Ctrl+X/Ctrl+R), so the
 * history search lives on the free Ctrl+F.
 */
describe("UserInput history search", () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  const renderInput = async () => {
    const tree = render(
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />,
    );
    await untilFrame(tree, (frame) => frame.length > 0);
    return tree;
  };

  /** Seeds the history through the real path: typing a line and submitting. */
  const seed = async (tree: ReturnType<typeof render>, ...lines: string[]) => {
    for (const line of lines) {
      tree.stdin.write(line);
      await tick();
      tree.stdin.write("\r");
      await tick();
    }
  };

  beforeEach(() => {
    onSubmit = vi.fn();
  });

  it("filters the history live and walks older matches with ctrl+f", async () => {
    const tree = await renderInput();
    try {
      await seed(
        tree,
        "hs-alpha zebra one",
        "hs-alpha yak two",
        "hs-beta three",
      );

      tree.stdin.write("\x06"); // ctrl+f opens the search, empty query
      const hint = await untilFrame(tree, (frame) =>
        frame.includes("history search"),
      );
      expect(hint).toContain("history search");
      expect(hint).toContain("0/0");

      tree.stdin.write("hs-alpha");
      let frame = await untilFrame(tree, (f) => f.includes("1/2"));
      expect(frame).toContain("1/2");
      expect(frame).toContain("hs-alpha yak two"); // newest match first

      tree.stdin.write("\x06"); // next-older match
      frame = await untilFrame(tree, (f) => f.includes("2/2"));
      expect(frame).toContain("2/2");
      expect(frame).toContain("hs-alpha zebra one");

      // At the oldest match the search stays put instead of wrapping. This one
      // asserts a non-change, which a wait cannot express, so it settles and
      // then reads the frame the way it is.
      tree.stdin.write("\x06");
      await tick(200);
      frame = tree.lastFrame() ?? "";
      expect(frame).toContain("2/2");
      expect(frame).toContain("hs-alpha zebra one");
    } finally {
      tree.unmount();
    }
  });

  it("esc restores the text the box held before the search", async () => {
    const tree = await renderInput();
    try {
      await seed(tree, "hs-keep-me");
      // Half-typed text is the search's initial query and its restore point.
      tree.stdin.write("hs-keep");
      await tick();

      tree.stdin.write("\x06");
      await tick();
      tree.stdin.write("\x06"); // walk to the match
      await untilFrame(tree, (f) => f.includes("hs-keep-me"));
      expect(tree.lastFrame() ?? "").toContain("hs-keep-me");

      tree.stdin.write("\x1b");
      const frame = await untilFrame(
        tree,
        (f) => !f.includes("history search") && f.includes("hs-keep"),
      );
      expect(frame).not.toContain("history search");
      expect(frame).toContain("hs-keep");
    } finally {
      tree.unmount();
    }
  });

  it("enter selects the match without submitting it", async () => {
    const tree = await renderInput();
    try {
      await seed(tree, "hs-pick-me");
      const submitsBefore = onSubmit.mock.calls.length;

      tree.stdin.write("\x06");
      await tick();
      tree.stdin.write("pick");
      await untilFrame(tree, (f) => f.includes("hs-pick-me"));
      expect(tree.lastFrame() ?? "").toContain("hs-pick-me");

      tree.stdin.write("\r");
      const frame = await untilFrame(
        tree,
        (f) => !f.includes("history search") && f.includes("hs-pick-me"),
      );
      expect(frame).not.toContain("history search");
      expect(frame).toContain("hs-pick-me");
      // Selecting only fills the box; nothing was sent to the engine.
      expect(onSubmit.mock.calls.length).toBe(submitsBefore);

      // A second Enter submits the selected line like any other input.
      tree.stdin.write("\r");
      await until(() => onSubmit.mock.calls.length === submitsBefore + 1);
      expect(onSubmit.mock.calls.at(-1)?.[0]).toBe("hs-pick-me");
    } finally {
      tree.unmount();
    }
  });

  it("backspace narrows the query back out", async () => {
    const tree = await renderInput();
    try {
      await seed(tree, "hs-narrow-yes", "hs-narrow-no");

      tree.stdin.write("\x06");
      await tick();
      tree.stdin.write("hs-narrow-y");
      await untilFrame(tree, (f) => f.includes("1/1"));
      expect(tree.lastFrame() ?? "").toContain("1/1");

      tree.stdin.write("\x7f"); // drop the y: both entries match again
      const frame = await untilFrame(tree, (f) => f.includes("1/2"));
      expect(frame).toContain("1/2");
      expect(frame).toContain("hs-narrow-no"); // newest first again
    } finally {
      tree.unmount();
    }
  });
});
