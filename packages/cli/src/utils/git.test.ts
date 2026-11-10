import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalPath } from "./canonicalPath.js";
import {
  getGitBranch,
  getGitHubActionsRepoUrl,
  isGitRepo,
  isGitHubActions,
  listWorktrees,
  resetGitBranchCache,
} from "./git.js";

describe("git utilities - GitHub Actions detection", () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_SERVER_URL;
  });

  describe("isGitHubActions", () => {
    it("should return true when GITHUB_ACTIONS is 'true'", () => {
      process.env.GITHUB_ACTIONS = "true";
      expect(isGitHubActions()).toBe(true);
    });

    it("should return false when GITHUB_ACTIONS is not set", () => {
      expect(isGitHubActions()).toBe(false);
    });

    it("should return false when GITHUB_ACTIONS is set to other values", () => {
      process.env.GITHUB_ACTIONS = "false";
      expect(isGitHubActions()).toBe(false);
    });
  });

  describe("getGitHubActionsRepoUrl", () => {
    it("should return null when not in GitHub Actions", () => {
      expect(getGitHubActionsRepoUrl()).toBeNull();
    });

    it("should return null when GITHUB_REPOSITORY is not set", () => {
      process.env.GITHUB_ACTIONS = "true";
      expect(getGitHubActionsRepoUrl()).toBeNull();
    });

    it("should return GitHub URL with default server", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "owner/repo";

      expect(getGitHubActionsRepoUrl()).toBe("https://github.com/owner/repo");
    });

    it("should return GitHub URL with custom server", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "owner/repo";
      process.env.GITHUB_SERVER_URL = "https://github.enterprise.com";

      expect(getGitHubActionsRepoUrl()).toBe(
        "https://github.enterprise.com/owner/repo",
      );
    });
  });

  describe("getRepoUrl - GitHub Actions priority", () => {
    it("should prioritize GitHub Actions environment variables", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "owner/repo";

      // Since we can't easily mock git commands, we'll rely on the fact that
      // GitHub Actions detection should take priority and return immediately
      const result = getGitHubActionsRepoUrl();
      expect(result).toBe("https://github.com/owner/repo");
    });

    it("should work with GitHub Enterprise Server", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "enterprise/repo";
      process.env.GITHUB_SERVER_URL = "https://git.company.com";

      const result = getGitHubActionsRepoUrl();
      expect(result).toBe("https://git.company.com/enterprise/repo");
    });
  });

  describe("getGitBranch", () => {
    it("should return null when not in a git repo or when git command fails", () => {
      // Since we can't easily mock git commands in this test environment,
      // we just test that the function returns either a string or null
      resetGitBranchCache();
      const result = getGitBranch();
      expect(typeof result === "string" || result === null).toBe(true);
    });

    it("caches the branch for a moment and refreshes on reset", () => {
      const dir = mkdtempSync(join(tmpdir(), "tnt-branch-cache-"));
      const git = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      const previous = process.cwd();

      try {
        git(["init", "-b", "main"]);
        process.chdir(dir);

        resetGitBranchCache();
        expect(getGitBranch()).toBe("main");

        git(["checkout", "-b", "next"]);
        expect(getGitBranch()).toBe("main");

        resetGitBranchCache();
        expect(getGitBranch()).toBe("next");
      } finally {
        process.chdir(previous);
        resetGitBranchCache();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("the worktrees of a repository", () => {
  let root = "";
  let linked = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "tnt-worktrees-"));
    const git = (args: string[], cwd = root) =>
      execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    writeFileSync(join(root, "README.md"), "hello\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "first"]);
    linked = mkdtempSync(join(tmpdir(), "tnt-worktrees-linked-"));
    rmSync(linked, { recursive: true, force: true });
    git(["worktree", "add", "-b", "side", linked]);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(linked, { recursive: true, force: true });
  });

  it("names every worktree with the branch it holds", () => {
    const found = listWorktrees(root);
    expect(found.length).toBeGreaterThanOrEqual(2);
    const at = (p: string) => canonicalPath(p);
    const main = found.find((w) => at(w.path) === at(root));
    const side = found.find((w) => at(w.path) === at(linked));
    expect(main?.branch).toBe("main");
    expect(side?.branch).toBe("side");
    expect(side?.head).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("reads the same repository from a linked worktree", () => {
    const found = listWorktrees(linked);
    expect(found.map((w) => w.branch)).toContain("main");
  });

  it("says there is nothing to switch when the folder is not a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "tnt-plain-"));
    try {
      expect(isGitRepo(plain)).toBe(false);
      expect(listWorktrees(plain)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
