import { execFile, execFileSync } from "child_process";
import { promisify } from "util";

import { canonicalPath } from "./canonicalPath.js";

const execFileAsync = promisify(execFile);
const LARGE_STDIO_BUFFER_BYTES = 10 * 1024 * 1024; // bump buffer for large git output

/**
 * Get the git remote URL for the current repository
 * @param remote The remote name (defaults to 'origin')
 * @returns The remote URL or null if not found
 */
export function getGitRemoteUrl(remote: string = "origin"): string | null {
  try {
    const result = execFileSync("git", ["remote", "get-url", remote], {
      encoding: "utf-8",
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Get the current git branch name
 * @returns The current branch name or null if not found
 */
export function getGitBranch(): string | null {
  try {
    const result = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a directory is inside a git repository
 * @param cwd The directory to ask from (defaults to the process's)
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
      cwd,
    });
    return true;
  } catch {
    return false;
  }
}

/** One entry of `git worktree list`: a checkout of the repository on disk. */
export interface WorktreeInfo {
  /** Absolute path of the checkout. */
  path: string;
  /** The branch it holds, null when detached or bare. */
  branch: string | null;
  /** The commit its HEAD points at. */
  head: string;
  /** True when HEAD is a commit rather than a branch. */
  detached: boolean;
  /** True for the bare repository itself, which has no working tree. */
  bare: boolean;
}

/**
 * Every checkout of the repository the directory belongs to.
 * @param cwd The directory to ask from (defaults to the process's)
 * @returns the worktrees in git's own order, empty when this is not a repository
 */
export function listWorktrees(cwd: string = process.cwd()): WorktreeInfo[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8",
      cwd,
      stdio: "pipe",
    });
  } catch {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        // Git spells the checkout with forward slashes and the 8.3 short
        // names of its own choosing; canonicalPath puts every spelling on
        // the same footing the other path comparisons in the CLI use.
        path: canonicalPath(line.slice("worktree ".length).trim()),
        branch: null,
        head: "",
        detached: false,
        bare: false,
      };
      worktrees.push(current);
      continue;
    }
    if (!current) continue;
    if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    }
  }
  return worktrees.filter((worktree) => !worktree.bare);
}

/**
 * Check if running in GitHub Actions
 */
export function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

/**
 * Check if a remote agent runner set its environment flag
 */
export function isRemoteAgent(): boolean {
  return process.env.TNT_REMOTE === "true";
}

/**
 * Get repository URL from GitHub Actions environment variables
 * @returns GitHub repository URL or null if not available
 */
export function getGitHubActionsRepoUrl(): string | null {
  if (!isGitHubActions()) {
    return null;
  }

  // GITHUB_REPOSITORY is in format "owner/repo"
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) {
    return null;
  }

  // GITHUB_SERVER_URL defaults to https://github.com but can be different for GitHub Enterprise
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";

  return `${serverUrl}/${githubRepository}`;
}

/**
 * Get the current repository URL with enhanced detection for CI environments
 * Priority order:
 * 1. GitHub Actions environment variables (if running in GitHub Actions)
 * 2. Git remote URL (if in a git repository)
 * 3. Current working directory (fallback)
 * @returns Repository URL or local path
 */
export function getRepoUrl(): string {
  // First, check if we're in GitHub Actions and can get repo URL from env vars
  const githubActionsUrl = getGitHubActionsRepoUrl();
  if (githubActionsUrl) {
    return githubActionsUrl;
  }

  // Then check if we're in a git repository
  if (!isGitRepo()) {
    return process.cwd();
  }

  // Try to get the remote URL from git
  const remoteUrl = getGitRemoteUrl();
  const url = remoteUrl || process.cwd();
  return url.endsWith(".git") ? url.slice(0, -4) : url;
}

export interface GitDiffSnapshot {
  diff: string;
  repoFound: boolean;
}

function isExecError(
  error: unknown,
): error is { code?: number; stdout?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "stdout" in error)
  );
}

export async function getGitDiffSnapshot(): Promise<GitDiffSnapshot> {
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], {
      maxBuffer: LARGE_STDIO_BUFFER_BYTES,
    });
  } catch (error) {
    if (isExecError(error) && error.code === 128) {
      return { diff: "", repoFound: false };
    }
    throw error;
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "main"], {
      maxBuffer: LARGE_STDIO_BUFFER_BYTES,
    });
    return { diff: stdout, repoFound: true };
  } catch (error) {
    if (isExecError(error)) {
      if (error.code === 1 && error.stdout) {
        return { diff: error.stdout, repoFound: true };
      }

      if (error.code === 128) {
        return { diff: "", repoFound: false };
      }
    }
    throw error;
  }
}
