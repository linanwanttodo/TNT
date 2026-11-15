import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeFileAtomically } from "./atomicWrite.js";

let workDir: string;

function leftoverTemporaryFiles(): string[] {
  return fs.readdirSync(workDir).filter((name) => name.endsWith(".tmp"));
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("writeFileAtomically", () => {
  it("replaces the contents and leaves no temporary file behind", () => {
    const file = path.join(workDir, "state.json");
    fs.writeFileSync(file, "old");

    writeFileAtomically(file, "new");

    expect(fs.readFileSync(file, "utf-8")).toBe("new");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("creates a file that does not exist yet", () => {
    const file = path.join(workDir, "fresh.json");

    writeFileAtomically(file, "content");

    expect(fs.readFileSync(file, "utf-8")).toBe("content");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("writes through a symlink instead of replacing it", () => {
    const target = path.join(workDir, "real.json");
    const link = path.join(workDir, "link.json");
    fs.writeFileSync(target, "old");
    fs.symlinkSync(target, link);

    writeFileAtomically(link, "new");

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });

  it("keeps the mode of the file it replaces", () => {
    const file = path.join(workDir, "private.json");
    fs.writeFileSync(file, "old", { mode: 0o600 });

    writeFileAtomically(file, "new");

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps the previous contents and cleans up when the final step fails", () => {
    const file = path.join(workDir, "state.json");
    fs.writeFileSync(file, "old");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("no space left on device");
    });

    expect(() => writeFileAtomically(file, "new")).toThrow();
    expect(fs.readFileSync(file, "utf-8")).toBe("old");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });
});
