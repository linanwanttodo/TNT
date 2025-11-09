import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentSession } from "../../session/index.js";
import { ToolResultSummary } from "../ToolResultSummary.js";

import {
  blockLineBudget,
  blockOverflowNotice,
  MAX_BLOCK_LINES,
  planBlock,
} from "./blockBudget.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24, isResizing: false }),
}));

function lines(count: number, from = 0): string[] {
  return Array.from({ length: count }, (_, index) => `line ${from + index}`);
}

describe("the block line budget", () => {
  it("is half the terminal, capped at the ceiling", () => {
    expect(blockLineBudget(24)).toBe(12);
    expect(blockLineBudget(40)).toBe(20);
    expect(blockLineBudget(80)).toBe(MAX_BLOCK_LINES);
    expect(blockLineBudget(200)).toBe(MAX_BLOCK_LINES);
  });

  it("never asks for fewer lines than it can show", () => {
    for (const rows of [0, 1, -12, Number.NaN]) {
      expect(blockLineBudget(rows)).toBe(1);
    }
  });

  it("cuts the block at the budget and hands over the rest", () => {
    const block = lines(7);

    const plan = planBlock(block, 5);
    expect(plan.shown).toEqual(lines(5));
    expect(plan.overflow).toEqual(["line 5", "line 6"]);

    // A block that fits is not copied into a different shape on the way out.
    expect(planBlock(block, 7)).toEqual({ shown: block, overflow: [] });
  });
});

describe("where the lines a block could not show go", () => {
  let home: string;
  let globalDir: string;
  let previousGlobalDir: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-block-overflow-"));
    globalDir = path.join(home, "global");
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = globalDir;
  });

  afterEach(() => {
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  function noticeFor(
    overflow: string[],
    toolName = "Bash",
  ): string | undefined {
    return blockOverflowNotice({
      sessionId: "session-1",
      toolName,
      overflow,
    });
  }

  it("names a file that holds exactly what was cut", () => {
    const overflow = lines(3, 12);
    const notice = noticeFor(overflow);
    expect(notice).toBeDefined();

    const written = notice!.slice(notice!.indexOf("→") + 1, -1).trim();
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, "utf-8")).toBe(`${overflow.join("\n")}\n`);
  });

  it("counts in the notice the lines it hid", () => {
    expect(noticeFor(lines(3, 12))).toMatch(/^\[\+3 lines → /);
    expect(noticeFor(lines(17, 4))).toMatch(/^\[\+17 lines → /);
  });

  it("keeps the file inside the session's own directory", () => {
    const notice = noticeFor(lines(2, 9))!;
    const written = notice.slice(notice.indexOf("→") + 1, -1).trim();

    const scoped = path.join(globalDir, "block-overflow", "session-1");
    expect(path.dirname(written)).toBe(scoped);
    // Resolved, not merely prefixed: a session id carrying traversal has to stay
    // inside the directory it was given.
    expect(path.resolve(written).startsWith(path.resolve(scoped))).toBe(true);
  });

  it("sanitizes a session id that is not a plain filename", () => {
    const notice = blockOverflowNotice({
      sessionId: "../../etc/passwd",
      toolName: "Bash",
      overflow: lines(2, 40),
    })!;
    const written = notice.slice(notice.indexOf("→") + 1, -1).trim();

    // One directory under `block-overflow`, named for the id with every path
    // separator replaced - so a hostile id cannot reach outside it.
    const scoped = path.join(globalDir, "block-overflow");
    const idDir = path.dirname(written);
    expect(path.basename(idDir)).toBe(".._.._etc_passwd");
    expect(idDir).toBe(path.join(scoped, ".._.._etc_passwd"));
    expect(path.resolve(written).startsWith(scoped + path.sep)).toBe(true);
  });

  it("writes once per distinct overflow", () => {
    const overflow = lines(4, 20);
    const first = noticeFor(overflow)!;
    const written = first.slice(first.indexOf("→") + 1, -1).trim();

    // A settled block re-renders on every keystroke, so the second call must
    // reuse the file rather than rewrite it.
    fs.writeFileSync(written, "SENTINEL", "utf-8");
    expect(noticeFor(overflow)).toBe(first);
    expect(fs.readFileSync(written, "utf-8")).toBe("SENTINEL");

    // Different text is a different block, and gets its own file.
    expect(noticeFor([...overflow, "one more"])).not.toBe(first);
  });

  it("prints no path it could not write", () => {
    // A file where the directory has to be: the store cannot be created.
    fs.writeFileSync(globalDir, "not a directory", "utf-8");

    expect(noticeFor(lines(2, 30))).toBeUndefined();
  });

  it("returns nothing at all when the block needed no cut", () => {
    expect(
      blockOverflowNotice({
        sessionId: "session-1",
        toolName: "Bash",
        overflow: [],
      }),
    ).toBeUndefined();
  });

  it("bounds what one session leaves behind", () => {
    for (let index = 0; index < 60; index++) {
      expect(
        blockOverflowNotice({
          sessionId: "session-1",
          toolName: `Tool${index}`,
          overflow: lines(2, index * 100),
        }),
      ).toBeDefined();
    }

    const scoped = path.join(globalDir, "block-overflow", "session-1");
    expect(fs.readdirSync(scoped)).toHaveLength(50);
  });
});

describe("the budget the transcript block actually uses", () => {
  let home: string;
  let previousGlobalDir: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-block-render-"));
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = path.join(home, "global");
  });

  afterEach(() => {
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("shows the budget's worth of lines and points at the rest", () => {
    // 24 mocked rows against a 15-line block: 12 shown, 3 saved beside the session.
    const tree = render(
      <ToolResultSummary toolName="Bash" content={lines(15).join("\n")} />,
    );
    const frame = tree.lastFrame() ?? "";
    tree.unmount();

    expect(frame).toContain("line 11");
    expect(frame).not.toContain("line 12");

    const expectedPath = path.join(
      home,
      "global",
      "block-overflow",
      getCurrentSession()
        .sessionId.replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 64),
    );
    // Whitespace is dropped on both sides: a path longer than the terminal wraps,
    // and whether it fits is a layout question this round does not claim to answer.
    expect(frame.replace(/\s+/g, "")).toContain(
      `[+3lines→${expectedPath.replace(/\s+/g, "")}`,
    );
  });

  it("prints the plain count when there is nowhere to save", () => {
    fs.writeFileSync(path.join(home, "global"), "not a directory", "utf-8");

    const tree = render(
      <ToolResultSummary toolName="Bash" content={lines(15).join("\n")} />,
    );
    const frame = tree.lastFrame() ?? "";
    tree.unmount();

    expect(frame).toContain("... +3 lines");
    expect(frame).not.toContain("→");
  });
});
