import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceRoot } from "../permissions/workspacePath.js";

import { assertDeletablePath, deleteFileTool } from "./deleteFile.js";

let workspace: string;
let trashHome: string;
let previousCwd: string;

beforeEach(() => {
  previousCwd = process.cwd();
  // The scratch tree lives in the system temporary directory, not in the
  // package: a directory another suite is walking can disappear mid-walk, and
  // the tool's own workspace default is the working directory, so the run sits
  // inside the tree it is deleting from.
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tnt-delete-")),
  );
  process.chdir(workspace);
  trashHome = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-trash-"));
  vi.stubEnv("CONTINUE_GLOBAL_DIR", trashHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(previousCwd);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(trashHome, { recursive: true, force: true });
});

function trashEntries(): string[] {
  const root = path.join(trashHome, "trash");
  return fs.existsSync(root) ? fs.readdirSync(root) : [];
}

describe("assertDeletablePath", () => {
  it("refuses the root, .git and paths outside the given workspace", () => {
    fs.mkdirSync(path.join(workspace, ".git"));
    fs.writeFileSync(path.join(workspace, ".git", "config"), "x");

    expect(() => assertDeletablePath(workspace, workspace)).toThrow(
      /workspace root/,
    );
    expect(() =>
      assertDeletablePath(path.join(workspace, ".git", "config"), workspace),
    ).toThrow(/\.git/);
    expect(() =>
      assertDeletablePath(path.join(workspace, "..", "escape.txt"), workspace),
    ).toThrow(/inside the workspace/);
  });

  it("refuses a path that does not exist", () => {
    expect(() =>
      assertDeletablePath(path.join(workspace, "missing.txt"), workspace),
    ).toThrow(/No such file/);
  });
});

describe("Delete", () => {
  it("moves a file into the trash and says where it went", async () => {
    const file = path.join(workspace, "notes.txt");
    fs.writeFileSync(file, "keep this\n");

    const result = await deleteFileTool.run!({ filepath: file });

    expect(fs.existsSync(file)).toBe(false);
    expect(result).toContain("recoverable");
    const [entry] = trashEntries();
    expect(entry).toBeDefined();
    const restored = path.join(
      trashHome,
      "trash",
      entry,
      path.relative(workspaceRoot(), file),
    );
    expect(fs.readFileSync(restored, "utf-8")).toBe("keep this\n");
  });

  it("requires recursive for a directory, then moves the whole tree", async () => {
    const directory = path.join(workspace, "dir");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "a.txt"), "a\n");

    await expect(deleteFileTool.run!({ filepath: directory })).rejects.toThrow(
      /recursive: true/,
    );

    await deleteFileTool.run!({ filepath: directory, recursive: true });

    expect(fs.existsSync(directory)).toBe(false);
    const restored = path.join(
      trashHome,
      "trash",
      trashEntries()[0],
      path.relative(workspaceRoot(), directory),
      "a.txt",
    );
    expect(fs.readFileSync(restored, "utf-8")).toBe("a\n");
  });

  it("deletes a symlink without deleting its target", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-delete-target-"),
    );
    const link = path.join(workspace, "link");
    try {
      fs.symlinkSync(outside, link);

      await deleteFileTool.run!({ filepath: link });

      expect(() => fs.lstatSync(link)).toThrow();
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("previews the deletion before it runs", async () => {
    const processed = await deleteFileTool.preprocess!({
      filepath: path.join(workspace, "notes.txt"),
    });

    expect(JSON.stringify(processed.preview)).toContain("Will delete");
  });
});
