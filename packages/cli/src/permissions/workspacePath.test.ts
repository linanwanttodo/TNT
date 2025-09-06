import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isWithinWorkspace, workspaceRoot } from "./workspacePath.js";

describe("workspace containment", () => {
  let root: string;
  let sibling: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tnt-ws-")));
    sibling = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "tnt-out-")),
    );
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "x\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  });

  it("holds an existing file and one that is not written yet", () => {
    expect(isWithinWorkspace(path.join(root, "src", "a.ts"), root)).toBe(true);
    expect(isWithinWorkspace(path.join(root, "src", "new", "b.ts"), root)).toBe(
      true,
    );
  });

  it("measures a relative path against the working directory", () => {
    const before = process.cwd();
    process.chdir(root);
    try {
      expect(isWithinWorkspace("src/a.ts")).toBe(true);
      expect(isWithinWorkspace("../tnt-out-of-it.ts")).toBe(false);
    } finally {
      process.chdir(before);
    }
  });

  it("refuses a path that walks out with ..", () => {
    const escaping = path.join(root, "src", "..", "..", "elsewhere.ts");
    expect(isWithinWorkspace(escaping, root)).toBe(false);
  });

  it("follows a link that points outside", () => {
    const target = path.join(sibling, "real");
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(root, "link"));

    expect(isWithinWorkspace(path.join(root, "link", "note.md"), root)).toBe(
      false,
    );
  });

  it("keeps a link that stays inside", () => {
    const target = path.join(root, "inside");
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(root, "alias"));

    expect(isWithinWorkspace(path.join(root, "alias", "note.md"), root)).toBe(
      true,
    );
  });

  it("treats a call that names no path as outside", () => {
    expect(isWithinWorkspace(undefined, root)).toBe(false);
    expect(isWithinWorkspace("", root)).toBe(false);
    expect(isWithinWorkspace("   ", root)).toBe(false);
    expect(isWithinWorkspace(42, root)).toBe(false);
  });

  it("names the working directory when no root is given", () => {
    expect(workspaceRoot()).toBe(fs.realpathSync(process.cwd()));
  });

  it("refuses the parent of the workspace", () => {
    expect(isWithinWorkspace(path.dirname(root), root)).toBe(false);
  });
});
