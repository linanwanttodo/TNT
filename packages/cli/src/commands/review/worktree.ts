import { execFile, execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { logger } from "../../utils/logger.js";

const execFileAsync = promisify(execFile);

const INITIAL_STATE_MESSAGE =
  "tnt-review: user working tree state (staged + unstaged + untracked)";

/**
 * The worktree starts at a committed ref, so the files nobody has committed
 * yet have to be carried over by hand - they are part of what is being reviewed.
 */
async function copyUntrackedFiles(worktreePath: string): Promise<void> {
  const { stdout: untrackedOutput } = await execFileAsync("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (!untrackedOutput.trim()) return;

  const cwd = process.cwd();
  for (const file of untrackedOutput.trim().split("\n")) {
    const srcPath = path.join(cwd, file);
    const destPath = path.join(worktreePath, file);
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    try {
      fs.copyFileSync(srcPath, destPath);
    } catch {
      // Skip files that can't be copied
    }
  }
}

/**
 * Create a git worktree that mirrors the user's current working tree state.
 * The worktree gets committed + staged + unstaged + untracked changes.
 *
 * A ref pins the worktree to a commit instead, and then the working tree is
 * deliberately not copied over it: reviewing a commit means reading the tree
 * as that commit left it, not as the moment happens to look.
 */
export async function createWorktree(
  index: number,
  options: { ref?: string; includeWorkingTree?: boolean } = {},
): Promise<string> {
  const includeWorkingTree = options.includeWorkingTree !== false;
  const tmpDir = os.tmpdir();
  const worktreePath = path.join(tmpDir, `tnt-review-${Date.now()}-${index}`);

  // Create the worktree at the target (detached)
  await execFileAsync("git", [
    "worktree",
    "add",
    worktreePath,
    options.ref ?? "HEAD",
    "--detach",
  ]);

  if (includeWorkingTree) {
    // Apply uncommitted changes (staged + unstaged) to the worktree
    try {
      const { stdout: diff } = await execFileAsync("git", ["diff", "HEAD"], {
        maxBuffer: 10 * 1024 * 1024,
      });
      if (diff.trim()) {
        execFileSync(
          "git",
          ["-C", worktreePath, "apply", "--allow-empty", "-"],
          {
            input: diff,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      }
    } catch (e) {
      logger.debug("Could not apply uncommitted changes to worktree", {
        error: e,
      });
    }

    // Copy untracked files to the worktree
    try {
      await copyUntrackedFiles(worktreePath);
    } catch (e) {
      logger.debug("Could not copy untracked files to worktree", { error: e });
    }
  }

  // Commit the initial state so captureWorktreeDiff only captures agent changes
  await execFileAsync("git", ["-C", worktreePath, "add", "-A"]);
  await execFileAsync("git", [
    "-C",
    worktreePath,
    "commit",
    "-m",
    INITIAL_STATE_MESSAGE,
    "--allow-empty",
    "--no-verify",
  ]);

  return worktreePath;
}

/**
 * Capture the diff of changes the agent made in the worktree.
 * Returns a unified diff patch string.
 */
export function captureWorktreeDiff(worktreePath: string): string {
  try {
    // Add all new files so they show up in the diff
    execFileSync("git", ["-C", worktreePath, "add", "-A"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return execFileSync("git", ["-C", worktreePath, "diff", "--cached"], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

/**
 * Remove a git worktree.
 */
export async function cleanupWorktree(worktreePath: string): Promise<void> {
  try {
    await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"]);
  } catch (e) {
    logger.debug("Could not remove worktree, attempting manual cleanup", {
      worktreePath,
      error: e,
    });
    // Manual cleanup as fallback
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
      await execFileAsync("git", ["worktree", "prune"]);
    } catch {
      // Best effort
    }
  }
}
