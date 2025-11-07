import fs from "fs";
import os from "os";
import path from "path";

import { ContinueError } from "core/util/errors.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changedSinceSeen, forgetSeenFiles } from "./fileState.js";
import { readFileTool, readRange } from "./readFile.js";

describe("readRange", () => {
  it("is absent when neither end is given", () => {
    expect(readRange({}, 100)).toBeNull();
  });

  it("demands both ends, so a half range cannot read to the end by accident", () => {
    expect(() => readRange({ start_line: 5 }, 100)).toThrow(/both be given/);
    expect(() => readRange({ end_line: 20 }, 100)).toThrow(/both be given/);
    expect(() => readRange({ start_line: 20, end_line: 5 }, 100)).toThrow(
      /end_line at or after start_line/,
    );
  });

  it("counts from one and clamps the tail to the file", () => {
    expect(readRange({ start_line: 2, end_line: 4 }, 100)).toEqual({
      start: 2,
      end: 4,
    });
    expect(readRange({ start_line: 2, end_line: 500 }, 4)).toEqual({
      start: 2,
      end: 4,
    });
    expect(() => readRange({ start_line: 0, end_line: 3 }, 100)).toThrow(
      /counts from 1/,
    );
    expect(() => readRange({ start_line: 101, end_line: 110 }, 100)).toThrow(
      /past the end/,
    );
  });
});

describe("Read with a line range", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    forgetSeenFiles();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-read-range-"));
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);
    target = path.join(dir, "ten.txt");
    fs.writeFileSync(target, `${lines.join("\n")}\n`);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    forgetSeenFiles();
  });

  it("returns only the section asked for, saying which lines they are", async () => {
    const result = await readFileTool.run({
      filepath: target,
      start_line: 3,
      end_line: 5,
    } as any);

    expect(result).toContain("lines 3-5 of 11");
    expect(result).toContain("line 3");
    expect(result).toContain("line 5");
    expect(result).not.toContain("line 6");
    expect(result).not.toContain("line 2");
    // Each line arrives prefixed with its own number, which is what makes a
    // `path:line` citation checkable by the reader.
    expect(result).toContain("3\tline 3");
    expect(result).toContain("5\tline 5");
    expect(result).not.toContain("\nline 4\n");
  });

  it("records the file as read, so a later edit is judged against its contents", async () => {
    await readFileTool.run({
      filepath: target,
      start_line: 1,
      end_line: 2,
    } as any);

    // A section read still stamps the whole file: the edit guard asks whether the
    // file moved since it was read, not how much of it was looked at.
    expect(changedSinceSeen(target)).toBe(false);
    fs.writeFileSync(target, "changed\n");
    expect(changedSinceSeen(target)).toBe(true);
  });

  it("still refuses an oversized file with no range, and points at the range", async () => {
    const big = path.join(dir, "big.txt");
    fs.writeFileSync(
      big,
      Array.from({ length: 6000 }, (_, index) => `line ${index}`).join("\n"),
    );

    await expect(readFileTool.run({ filepath: big } as any)).rejects.toThrow(
      ContinueError,
    );
    await expect(readFileTool.run({ filepath: big } as any)).rejects.toThrow(
      /start_line and end_line/,
    );
  });

  it("reads a section of a file too large for one whole read", async () => {
    const big = path.join(dir, "big.txt");
    fs.writeFileSync(
      big,
      Array.from({ length: 6000 }, (_, index) => `line ${index}`).join("\n"),
    );

    const result = await readFileTool.run({
      filepath: big,
      start_line: 100,
      end_line: 105,
    } as any);

    // The file's own labels are zero-based, so line 100 reads "line 99".
    expect(result).toContain("lines 100-105 of 6000");
    expect(result).toContain("line 99");
    expect(result).toContain("line 104");
    expect(result).not.toContain("line 105");
    expect(result).not.toContain("line 98");
  });
});
