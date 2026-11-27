import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInWorkspaceScope } from "../utils/workspaceScope.js";

import { cleanupSubagentWorktree, createSubagentWorktree } from "./worktree.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagent-worktree-"));
  execFileSync("git", ["init", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(root, "file.txt"), "committed\n");
  execFileSync("git", ["-C", root, "add", "file.txt"]);
  execFileSync("git", ["-C", root, "commit", "-m", "initial"]);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("subagent worktree isolation", () => {
  it("creates an independent checkout and cleans it up", async () => {
    fs.writeFileSync(path.join(root, "file.txt"), "uncommitted\n");
    const worktree = await runInWorkspaceScope(root, () =>
      createSubagentWorktree(),
    );

    expect(worktree).not.toBe(root);
    expect(fs.readFileSync(path.join(worktree, "file.txt"), "utf8")).toBe(
      "committed\n",
    );
    fs.writeFileSync(path.join(worktree, "file.txt"), "child change\n");
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe(
      "uncommitted\n",
    );

    await cleanupSubagentWorktree(worktree);
    expect(fs.existsSync(worktree)).toBe(false);
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe(
      "uncommitted\n",
    );
  });
});
