import * as os from "os";
import * as path from "path";

import { describe, expect, it } from "vitest";

import {
  isDestructiveCall,
  isDestructiveCommand,
} from "./destructiveCommands.js";

describe("destructive commands", () => {
  it("recognizes a hard reset", () => {
    expect(isDestructiveCommand("git reset --hard")).toBe(true);
    expect(isDestructiveCommand("git reset --hard HEAD~2")).toBe(true);
    expect(isDestructiveCommand("git -C repo reset --hard")).toBe(true);
    expect(isDestructiveCommand("FOO=1 git reset --hard")).toBe(true);
    expect(isDestructiveCommand("/usr/bin/git reset --hard")).toBe(true);
    // A soft or mixed reset moves the index, not the working tree.
    expect(isDestructiveCommand("git reset")).toBe(false);
    expect(isDestructiveCommand("git reset --soft HEAD~1")).toBe(false);
  });

  it("recognizes a checkout that discards the working tree", () => {
    expect(isDestructiveCommand("git checkout -- src/app.ts")).toBe(true);
    expect(isDestructiveCommand("git checkout HEAD -- .")).toBe(true);
    expect(isDestructiveCommand("git checkout .")).toBe(true);
    expect(isDestructiveCommand("git checkout -f main")).toBe(true);
    // Switching branches is not a discard.
    expect(isDestructiveCommand("git checkout main")).toBe(false);
    expect(isDestructiveCommand("git checkout -b feature")).toBe(false);
  });

  it("recognizes a forced clean", () => {
    expect(isDestructiveCommand("git clean -fd")).toBe(true);
    expect(isDestructiveCommand("git clean -f")).toBe(true);
    expect(isDestructiveCommand("git clean -df")).toBe(true);
    expect(isDestructiveCommand("git clean --force -d")).toBe(true);
    expect(isDestructiveCommand("git clean -nfd")).toBe(false);
    expect(isDestructiveCommand("git clean -d")).toBe(false);
  });

  it("recognizes restoring over the working tree, but not an unstage", () => {
    expect(isDestructiveCommand("git restore src/app.ts")).toBe(true);
    expect(isDestructiveCommand("git restore --worktree .")).toBe(true);
    expect(isDestructiveCommand("git restore --staged src/app.ts")).toBe(false);
    expect(isDestructiveCommand("git restore -S src/app.ts")).toBe(false);
  });

  it("recognizes the other history and branch destruction", () => {
    expect(isDestructiveCommand("git branch -D old-work")).toBe(true);
    expect(isDestructiveCommand("git branch -d old-work")).toBe(false);
    expect(isDestructiveCommand("git stash drop")).toBe(true);
    expect(isDestructiveCommand("git stash clear")).toBe(true);
    expect(isDestructiveCommand("git push --force origin main")).toBe(true);
    expect(isDestructiveCommand("git push -f origin main")).toBe(true);
    expect(
      isDestructiveCommand("git push --force-with-lease origin main"),
    ).toBe(true);
    expect(isDestructiveCommand("git filter-branch --all")).toBe(true);
    expect(isDestructiveCommand("git reflog expire --expire=now --all")).toBe(
      true,
    );
    expect(isDestructiveCommand("git gc --prune=now")).toBe(true);
    expect(isDestructiveCommand("git push origin main")).toBe(false);
  });

  it("escalates a forced recursive removal only when a target leaves the workspace", () => {
    const outside = path.join(os.tmpdir(), "tnt-destructive-outside", "file");

    expect(isDestructiveCommand(`rm -rf ${outside}`)).toBe(true);
    expect(isDestructiveCommand("rm -rf ..")).toBe(true);
    expect(isDestructiveCommand("rm -rf .")).toBe(true);
    expect(isDestructiveCommand(`rm -r -f ${outside}`)).toBe(true);
    expect(isDestructiveCommand("rm --recursive --force ../elsewhere")).toBe(
      true,
    );
    expect(isDestructiveCommand("rm -rf $HOME/build")).toBe(true);

    // A build directory inside the workspace is an ordinary removal.
    expect(isDestructiveCommand("rm -rf node_modules")).toBe(false);
    expect(isDestructiveCommand("rm -rf dist cache")).toBe(false);
    // Missing either half is not the forced recursive shape.
    expect(isDestructiveCommand(`rm -r ${outside}`)).toBe(false);
    expect(isDestructiveCommand(`rm -f ${outside}`)).toBe(false);
  });

  it("judges every segment of a chain", () => {
    expect(isDestructiveCommand("ls && git reset --hard")).toBe(true);
    expect(isDestructiveCommand("echo hi; git clean -fd")).toBe(true);
    expect(isDestructiveCommand("ls && git status")).toBe(false);
  });

  it("leaves ordinary development commands alone", () => {
    for (const command of [
      "ls -la",
      "git status",
      "git diff",
      "git commit -m 'test'",
      "git add .",
      "npm install pkg",
      "npm test",
      "echo hello",
    ]) {
      expect(isDestructiveCommand(command), command).toBe(false);
    }
    expect(isDestructiveCommand(undefined)).toBe(false);
    expect(isDestructiveCommand("")).toBe(false);
  });

  it("only reads a command from the shell tool", () => {
    expect(isDestructiveCall("Bash", { command: "git reset --hard" })).toBe(
      true,
    );
    expect(isDestructiveCall("Search", { command: "git reset --hard" })).toBe(
      false,
    );
    expect(isDestructiveCall("Bash", {})).toBe(false);
  });
});
