import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { cleanupWorktree, createWorktree } from "./worktree.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function makeRepo(): { repo: string; baseSha: string; featureSha: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-worktree-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "base"]);
  const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
  fs.writeFileSync(path.join(repo, "a.txt"), "one\nfeature\n");
  git(repo, ["commit", "-am", "feature"]);
  const featureSha = git(repo, ["rev-parse", "HEAD"]).trim();
  fs.writeFileSync(path.join(repo, "a.txt"), "one\nfeature\nlocal\n");
  return { repo, baseSha, featureSha };
}

describe("createWorktree", () => {
  const previousCwd = process.cwd();

  afterAll(() => {
    process.chdir(previousCwd);
  });

  it("carries an untracked file with a non-ascii name into the worktree", async () => {
    const { repo } = makeRepo();
    process.chdir(repo);
    const name = `${String.fromCharCode(0x6d4b, 0x8bd5)}.ts`;
    // git's default listing escapes such a name into a string that is no longer
    // a path it can open, and the copy that fails to open it says nothing.
    git(repo, ["config", "core.quotepath", "true"]);
    fs.writeFileSync(path.join(repo, name), "export const draft = 1;\n");

    const worktree = await createWorktree(9);
    try {
      expect(fs.existsSync(path.join(worktree, name))).toBe(true);
      expect(fs.readFileSync(path.join(worktree, name), "utf-8")).toContain(
        "draft = 1",
      );
    } finally {
      await cleanupWorktree(worktree);
    }
  });

  it("mirrors the working tree into a worktree at HEAD by default", async () => {
    const { repo } = makeRepo();
    process.chdir(repo);

    const worktree = await createWorktree(7);
    try {
      expect(fs.readFileSync(path.join(worktree, "a.txt"), "utf-8")).toContain(
        "local",
      );
    } finally {
      await cleanupWorktree(worktree);
    }
  });

  it("pins the worktree to a commit and keeps the later working tree out", async () => {
    const { repo, baseSha } = makeRepo();
    process.chdir(repo);

    // Not HEAD: pinning HEAD would pass even if the ref were ignored.
    const worktree = await createWorktree(8, {
      ref: baseSha,
      includeWorkingTree: false,
    });
    try {
      expect(fs.readFileSync(path.join(worktree, "a.txt"), "utf-8")).toBe(
        "one\n",
      );
    } finally {
      await cleanupWorktree(worktree);
    }
  });
});
