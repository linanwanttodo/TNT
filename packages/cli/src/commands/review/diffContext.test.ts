import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {
  computeDiffContext,
  reviewTargetFromOptions,
  worktreeOptionsForTarget,
} from "./diffContext.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

/**
 * A repo on `feature` with one committed change and one uncommitted change,
 * which is what separates the two targets: the branch diff contains both, the
 * uncommitted diff only the second.
 */
function makeDivergedRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-review-diff-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "base"]);

  git(repo, ["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\nfeature\n");
  git(repo, ["commit", "-am", "feature work"]);

  fs.writeFileSync(path.join(repo, "a.txt"), "one\nfeature\nlocal\n");
  return repo;
}

describe("computeDiffContext", () => {
  const previousCwd = process.cwd();

  afterAll(() => {
    process.chdir(previousCwd);
  });

  it("diffs the branch against the base in the default target", () => {
    const repo = makeDivergedRepo();
    process.chdir(repo);

    const context = computeDiffContext({ kind: "base", base: "main" });

    expect(context.baseBranch).toBe("main");
    expect(context.diff).toContain("+feature");
    expect(context.diff).toContain("+local");
    expect(context.changedFiles).toEqual(["a.txt"]);
  });

  it("diffs only the working tree against HEAD in the uncommitted target", () => {
    const repo = makeDivergedRepo();
    process.chdir(repo);

    const context = computeDiffContext({ kind: "uncommitted" });

    expect(context.baseBranch).toBe("HEAD");
    expect(context.diff).toContain("+local");
    // The committed feature work is not what this target reviews.
    expect(context.diff).not.toContain("+feature");
    expect(context.changedFiles).toEqual(["a.txt"]);
    expect(context.truncated).toBe(false);
  });

  it("sees a staged change in the uncommitted target", () => {
    const repo = makeDivergedRepo();
    process.chdir(repo);
    git(repo, ["add", "a.txt"]);

    const context = computeDiffContext({ kind: "uncommitted" });

    expect(context.diff).toContain("+local");
  });

  it("reviews one commit as that commit left the tree", () => {
    const repo = makeDivergedRepo();
    process.chdir(repo);
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();

    const context = computeDiffContext({ kind: "commit", ref: sha });

    expect(context.baseBranch).toBe(sha);
    expect(context.diff).toContain("+feature");
    // The working-tree change made after the commit is not part of it.
    expect(context.diff).not.toContain("+local");
    expect(context.changedFiles).toEqual(["a.txt"]);
  });

  it("reviews a root commit, which has no parent to diff against", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-review-root-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "first"]);
    process.chdir(repo);
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();

    const context = computeDiffContext({ kind: "commit", ref: sha });

    expect(context.diff).toContain("+one");
    expect(context.changedFiles).toEqual(["a.txt"]);
  });
});

describe("worktreeOptionsForTarget", () => {
  it("pins the worktree to the commit and leaves the working tree out", () => {
    expect(worktreeOptionsForTarget({ kind: "commit", ref: "abc123" })).toEqual(
      {
        ref: "abc123",
        includeWorkingTree: false,
      },
    );
  });

  it("leaves the worktree on the current state for the other targets", () => {
    expect(worktreeOptionsForTarget({ kind: "base" })).toEqual({});
    expect(worktreeOptionsForTarget({ kind: "uncommitted" })).toEqual({});
  });
});

describe("reviewTargetFromOptions", () => {
  it("defaults to the base target with auto-detection", () => {
    expect(reviewTargetFromOptions({})).toEqual({
      kind: "base",
      base: undefined,
    });
  });

  it("carries an explicit base", () => {
    expect(reviewTargetFromOptions({ base: "develop" })).toEqual({
      kind: "base",
      base: "develop",
    });
  });

  it("selects the uncommitted target", () => {
    expect(reviewTargetFromOptions({ uncommitted: true })).toEqual({
      kind: "uncommitted",
    });
  });

  it("selects the commit target", () => {
    expect(reviewTargetFromOptions({ commit: "abc123" })).toEqual({
      kind: "commit",
      ref: "abc123",
    });
  });

  it("refuses two targets at once", () => {
    expect(() =>
      reviewTargetFromOptions({ base: "main", uncommitted: true }),
    ).toThrow("--base and --uncommitted cannot be combined");
    expect(() =>
      reviewTargetFromOptions({ base: "main", commit: "abc" }),
    ).toThrow("--base and --commit cannot be combined");
    expect(() =>
      reviewTargetFromOptions({ uncommitted: true, commit: "abc" }),
    ).toThrow("--uncommitted and --commit cannot be combined");
  });
});
