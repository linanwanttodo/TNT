import fs from "fs";
import os from "os";
import path from "path";

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 *
 * A ceiling that runs out says only "not yet", which cannot tell a walk that is
 * slow from one that never moves, and the two want different fixes. So the
 * ceiling still decides the verdict and the extra watching only reports: how
 * long the condition took, or that it did not arrive at all.
 */
const CEILING = 4000;
const DIAGNOSTIC_CAP = 20_000;

async function until(want: () => boolean, timeoutMs = CEILING): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!want() && Date.now() < deadline) {
    await tick(25);
  }
}

async function untilFrame(
  tree: ReturnType<typeof render>,
  want: (frame: string) => boolean,
): Promise<string> {
  const started = Date.now();
  await until(() => want(tree.lastFrame() ?? ""));
  const frame = tree.lastFrame() ?? "";
  if (want(frame)) {
    return frame;
  }

  // Nothing arrived inside the ceiling. Keep watching, only to say what happens
  // next, and fail with both numbers rather than a stale frame.
  const exhausted = Date.now() - started;
  await until(() => want(tree.lastFrame() ?? ""), DIAGNOSTIC_CAP);
  const total = Date.now() - started;
  const arrived = want(tree.lastFrame() ?? "");
  throw new Error(
    `no frame matching the condition after ${exhausted}ms of the ${CEILING}ms ceiling\n` +
      `  it ${arrived ? `did arrive, ${total}ms after the keystroke` : `never arrived in the extra ${DIAGNOSTIC_CAP}ms`}\n` +
      `  last frame: ${frame.split("\n")[0] ?? "(empty)"}`,
  );
}

/**
 * Deliver one keystroke and wait for the frame it must produce.
 *
 * ink-testing-library's mock stdin can swallow a write that lands while React
 * is still committing the previous update - on a loaded Windows runner this
 * dropped a byte in roughly one run in three, and the assertions below read
 * like a broken filter when only the delivery was broken. A terminal re-sends
 * what got missed; the harness does the same, at most three times, and still
 * fails with the last frame when the behaviour itself is broken.
 */
async function press(
  tree: ReturnType<typeof render>,
  key: string,
  want: (frame: string) => boolean,
): Promise<string> {
  let lastFrame = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await tick(150);
    tree.stdin.write(key);
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      lastFrame = tree.lastFrame() ?? "";
      if (want(lastFrame)) return lastFrame;
      await tick(25);
    }
  }
  throw new Error(
    `keystroke ${JSON.stringify(key)} never produced its frame within 3 deliveries\n` +
      `  last frame: ${lastFrame.split("\n")[0] ?? "(empty)"}`,
  );
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
  let historyDir: string;

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
      await press(tree, line, (f) => f.includes(line));
      // The box has to be empty again before the next line: a submit that has
      // been counted but not yet cleared would seed the search's opening query.
      await press(tree, "\r", (f) => !f.includes(line));
    }
  };

  beforeEach(() => {
    onSubmit = vi.fn();
    // Each case mounts its own InputHistory, and without this the shared
    // per-worker global dir lets one case read what the previous case
    // submitted - the search then opens with a stale query and a nonzero
    // count on the Windows lane. A per-case temp dir gives the real load and
    // save path an empty file to start from.
    historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "input-history-"));
    process.env.TNT_INPUT_HISTORY_DIR = historyDir;
  });

  afterEach(() => {
    delete process.env.TNT_INPUT_HISTORY_DIR;
    fs.rmSync(historyDir, { recursive: true, force: true });
  });

  it("opens the search on an empty history when nothing was submitted yet", async () => {
    // The guard against cross-case contamination: every case points
    // InputHistory at its own directory, so a fresh mount must see no
    // entries at all - not what some other case on this worker submitted.
    const tree = await renderInput();
    try {
      await press(tree, "\x06", (f) => f.includes("history search"));
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain('history search ""');
      expect(frame).toContain("0/0");
    } finally {
      tree.unmount();
    }
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

      await press(tree, "\x06", (f) => f.includes("history search"));
      const hint = tree.lastFrame() ?? "";
      expect(hint).toContain("history search");
      expect(hint).toContain("0/0");

      let frame = await press(tree, "hs-alpha", (f) => f.includes("1/2"));
      expect(frame).toContain("1/2");
      expect(frame).toContain("hs-alpha yak two"); // newest match first

      frame = await press(tree, "\x06", (f) => f.includes("2/2")); // next-older match
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
      await press(tree, "hs-keep", (f) => f.includes("hs-keep"));

      await press(tree, "\x06", (f) => f.includes("history search"));
      await press(tree, "\x06", (f) => f.includes("hs-keep-me")); // walk to the match
      expect(tree.lastFrame() ?? "").toContain("hs-keep-me");

      const frame = await press(
        tree,
        "\x1b",
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

      await press(tree, "\x06", (f) => f.includes("history search"));
      let frame = await press(tree, "pick", (f) => f.includes("hs-pick-me"));
      expect(frame).toContain("hs-pick-me");

      frame = await press(
        tree,
        "\r",
        (f) => !f.includes("history search") && f.includes("hs-pick-me"),
      );
      expect(frame).not.toContain("history search");
      expect(frame).toContain("hs-pick-me");
      // Selecting only fills the box; nothing was sent to the engine.
      expect(onSubmit.mock.calls.length).toBe(submitsBefore);

      // A second Enter submits the selected line like any other input.
      await press(
        tree,
        "\r",
        () => onSubmit.mock.calls.length === submitsBefore + 1,
      );
      expect(onSubmit.mock.calls.at(-1)?.[0]).toBe("hs-pick-me");
    } finally {
      tree.unmount();
    }
  });

  it("backspace narrows the query back out", async () => {
    const tree = await renderInput();
    try {
      await seed(tree, "hs-narrow-yes", "hs-narrow-no");

      await press(tree, "\x06", (f) => f.includes("history search"));
      let frame = await press(tree, "hs-narrow-y", (f) => f.includes("1/1"));
      expect(frame).toContain("1/1");

      // drop the y: both entries match again
      frame = await press(tree, "\x7f", (f) => f.includes("1/2"));
      expect(frame).toContain("1/2");
      expect(frame).toContain("hs-narrow-no"); // newest first again
    } finally {
      tree.unmount();
    }
  });
});
