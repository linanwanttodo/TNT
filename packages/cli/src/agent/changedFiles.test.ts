import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeChangedFiles } from "./changedFiles.js";
import { forgetSeenFiles, markFileAsSeen } from "../tools/fileState.js";

/**
 * The note is produced from real files, because what it reports is a fact about
 * the filesystem and a mocked stat would test the mock.
 */
describe("describeChangedFiles", () => {
  let dir: string;

  function file(name: string, content: string): string {
    const target = path.join(dir, name);
    fs.writeFileSync(target, content);
    return target;
  }

  function touch(target: string, content: string): void {
    // A different size, so the change is detectable even when the clock behind
    // mtime has not moved on.
    fs.writeFileSync(target, content);
  }

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "tnt-changed-")),
    );
    forgetSeenFiles();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    forgetSeenFiles();
  });

  it("says nothing while nothing the model read has moved", () => {
    const seen = file("a.ts", "export const a = 1;\n");
    markFileAsSeen(seen);

    expect(describeChangedFiles()).toBeUndefined();
  });

  it("names a file that changed after it was read", () => {
    const seen = file("a.ts", "export const a = 1;\n");
    markFileAsSeen(seen);
    touch(seen, "export const a = 22;\n");

    const note = describeChangedFiles();

    expect(note).toContain("<system-reminder>");
    expect(note).toContain(seen);
    expect(note).toContain("changed on disk since you read them");
  });

  it("marks a deleted file as deleted", () => {
    const seen = file("gone.ts", "content\n");
    markFileAsSeen(seen);
    fs.rmSync(seen);

    expect(describeChangedFiles()).toContain(`${seen} (deleted)`);
  });

  it("mentions each change once, until the file moves again", () => {
    const seen = file("a.ts", "one\n");
    markFileAsSeen(seen);
    touch(seen, "two\n");

    expect(describeChangedFiles()).toContain(seen);
    expect(describeChangedFiles()).toBeUndefined();

    touch(seen, "three\n");
    expect(describeChangedFiles()).toContain(seen);
  });

  it("stops reporting a change once the model has read the file again", () => {
    const seen = file("a.ts", "one\n");
    markFileAsSeen(seen);
    touch(seen, "two\n");

    expect(describeChangedFiles()).toContain(seen);

    markFileAsSeen(seen);

    expect(describeChangedFiles()).toBeUndefined();
  });

  it("lists paths in a stable order", () => {
    const zebra = file("zebra.ts", "one\n");
    const alpha = file("alpha.ts", "one\n");
    markFileAsSeen(zebra);
    markFileAsSeen(alpha);
    touch(zebra, "two\n");
    touch(alpha, "two\n");

    const note = describeChangedFiles();

    expect(note!.indexOf(alpha)).toBeLessThan(note!.indexOf(zebra));
  });

  it("names eight paths and counts the rest", () => {
    const paths: string[] = [];
    for (let index = 0; index < 10; index++) {
      const target = file(`f${index}.ts`, "one\n");
      markFileAsSeen(target);
      paths.push(target);
    }
    for (const target of paths) {
      touch(target, "two\n");
    }

    const note = describeChangedFiles();

    expect(note).toContain("(and 2 more)");
    expect(note!.split("(deleted)").length - 1).toBe(0);
    expect(paths.slice(8).every((target) => !note!.includes(target))).toBe(
      true,
    );
  });
});
