import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { fireWorktreeCreate, fireWorktreeRemove } from "../hooks/fireHook.js";
import { disposeLspManager } from "../lsp/manager.js";
import { workspaceRoot } from "../utils/workspaceScope.js";

const execFileAsync = promisify(execFile);
const WORKTREE_PREFIX = "tnt-subagent-";

export async function createSubagentWorktree(): Promise<string> {
  const root = workspaceRoot();
  await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"]);
  const worktree = path.join(
    os.tmpdir(),
    `${WORKTREE_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`,
  );
  await execFileAsync("git", [
    "-C",
    root,
    "worktree",
    "add",
    "--detach",
    worktree,
    "HEAD",
  ]);
  await fireWorktreeCreate(path.basename(worktree)).catch(() => undefined);
  return worktree;
}

export async function cleanupSubagentWorktree(worktree: string): Promise<void> {
  if (path.basename(worktree).startsWith(WORKTREE_PREFIX) === false) return;
  await disposeLspManager(worktree).catch(() => undefined);
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      worktree,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    const root = path.dirname(stdout.trim());
    await execFileAsync("git", [
      "-C",
      root,
      "worktree",
      "remove",
      "--force",
      worktree,
    ]);
  } catch {
    fs.rmSync(worktree, { recursive: true, force: true });
    await execFileAsync("git", ["worktree", "prune"]).catch(() => undefined);
  }
  await fireWorktreeRemove(worktree).catch(() => undefined);
}
