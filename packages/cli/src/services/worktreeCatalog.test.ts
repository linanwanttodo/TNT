import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { canonicalPath, sameDirectory } from "../utils/canonicalPath.js";
import {
  currentCheckout,
  listCheckouts,
  moveToCheckout,
} from "./worktreeCatalog.js";

/**
 * The catalog reads the process's own working directory, so the suite moves
 * the test process into a repository it builds in a temporary directory.
 */
let root: string;
let main: string;
let linked: string;
const startDir = process.cwd();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-worktrees-"));
  main = path.join(root, "main");
  linked = path.join(root, "linked");
  fs.mkdirSync(main);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: main, stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(main, "file.txt"), "content\n");
  git("add", "file.txt");
  git("commit", "-m", "first");
  git("worktree", "add", "-b", "side", linked);

  process.chdir(main);
});

afterEach(() => {
  process.chdir(main);
});

afterAll(() => {
  process.chdir(startDir);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the checkouts a process can work in", () => {
  it("lists every checkout of the repository it is standing in", () => {
    const worktrees = listCheckouts();
    expect(worktrees.map((worktree) => worktree.branch)).toEqual(
      expect.arrayContaining(["main", "side"]),
    );
  });

  it("names the checkout the process is standing in", () => {
    expect(sameDirectory(currentCheckout()?.path ?? "", main)).toBe(true);
  });

  it("still names it from a directory inside the checkout", () => {
    const nested = path.join(main, "deep", "er");
    fs.mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    expect(sameDirectory(currentCheckout()?.path ?? "", main)).toBe(true);
  });

  it("says nothing when the process is not in a repository", () => {
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plain-"));
    try {
      process.chdir(loose);
      expect(listCheckouts()).toEqual([]);
      expect(currentCheckout()).toBeNull();
    } finally {
      // Windows refuses to remove a directory the process stands in.
      process.chdir(startDir);
      fs.rmSync(loose, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  it("moves the process into another checkout", () => {
    const moved = moveToCheckout(linked);
    expect(moved.branch).toBe("side");
    expect(sameDirectory(process.cwd(), linked)).toBe(true);
    expect(sameDirectory(currentCheckout()?.path ?? "", linked)).toBe(true);
  });

  it("refuses a directory that is not one of the repository's checkouts", () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-other-"));
    try {
      expect(() => moveToCheckout(elsewhere)).toThrow(/side|main|worktree/i);
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(main));
    } finally {
      process.chdir(startDir);
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
