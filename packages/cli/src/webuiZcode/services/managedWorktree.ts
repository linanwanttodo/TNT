import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { globalDir } from "../../config/globalDir.js";
import { sessionStore } from "../../session/store.js";
import { logger } from "../../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Managed worktrees (ZCode docs/git/worktree.md first version, TNT mapping).
 *
 * A worktree is not a new workspace - it is only a session's cwd. TNT's engine
 * registry already treats every path that way (an engine is created per
 * workspace path on demand), so the whole feature reduces to: create the
 * directory, hand it back, and let the normal createSession flow use it as the
 * workspace path. The session then runs, edits and commits inside the
 * worktree while the project's main checkout stays untouched.
 */

export interface ManagedWorktreeInfo {
  /** The worktree directory; this is the session cwd. */
  worktreePath: string;
  /** Short label "<repoName> · <bucket>" for the UI. */
  label: string;
  /** The branch the worktree was created from (detached when absent). */
  branch?: string;
}

export class ManagedWorktreeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not-a-repository"
      | "start-ref-missing"
      | "start-ref-missing-subdir"
      | "invalid-ref"
      | "git-failed"
      | "copy-failed",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ManagedWorktreeError";
  }
}

/** Fixed managed root: <data root>/worktrees/<bucket>/<repoName>. */
function managedRoot(): string {
  return path.join(globalDir(), "worktrees");
}

interface GitContext {
  /** The repo toplevel (worktrees always check out the whole repository). */
  toplevel: string;
  repoName: string;
  /** The project directory relative to the toplevel; empty at the root. */
  subdirectory: string;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.message}${"stderr" in error ? `: ${String((error as { stderr?: string }).stderr ?? "").trim()}` : ""}`
        : String(error);
    throw new ManagedWorktreeError(
      `git ${args[0]} failed`,
      "git-failed",
      detail,
    );
  }
}

async function resolveContext(workspacePath: string): Promise<GitContext> {
  const { stdout: toplevelRaw } = await git(workspacePath, [
    "rev-parse",
    "--show-toplevel",
  ]);
  const toplevel = toplevelRaw.trim();
  if (toplevel === "") {
    throw new ManagedWorktreeError(
      "not a git repository",
      "not-a-repository",
      workspacePath,
    );
  }
  const relative = path.relative(toplevel, path.resolve(workspacePath));
  const subdirectory =
    relative === "" || relative.startsWith("..") ? "" : relative;
  return {
    toplevel,
    repoName: path.basename(toplevel),
    subdirectory,
  };
}

/**
 * The worktree always checks out the whole repository, but the task cwd keeps
 * the project directory's position inside it (monorepo roots).
 */
function taskCwd(worktreeRoot: string, context: GitContext): string {
  if (context.subdirectory === "") return worktreeRoot;
  const joined = path.join(worktreeRoot, context.subdirectory);
  if (!fs.existsSync(joined)) {
    throw new ManagedWorktreeError(
      "the project directory does not exist in the worktree",
      "start-ref-missing-subdir",
      context.subdirectory,
    );
  }
  return joined;
}

function bucket(): string {
  // 4 hex chars keep Windows paths short; the collision window is tiny and a
  // retried mkdir re-rolls.
  return randomBytes(2).toString("hex");
}

/**
 * `git worktree add` checks out tracked files only, so a fresh worktree lacks
 * `.env` and friends. A repo declares what to bring with `.worktreeinclude`
 * (gitignore syntax); the listed ignored files are copied from the main
 * checkout. Without the file nothing is copied.
 */
async function copyIgnoredFiles(
  context: GitContext,
  worktreeRoot: string,
): Promise<number> {
  const includePath = path.join(context.toplevel, ".worktreeinclude");
  if (!fs.existsSync(includePath)) return 0;
  let listing: string;
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-from=.worktreeinclude",
        "--exclude-standard",
      ],
      { cwd: context.toplevel, maxBuffer: 16 * 1024 * 1024 },
    );
    listing = stdout;
  } catch (error) {
    throw new ManagedWorktreeError(
      "could not list .worktreeinclude files",
      "git-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  let copied = 0;
  for (const line of listing.split("\n")) {
    const relative = line.trim();
    if (relative === "") continue;
    const source = path.join(context.toplevel, relative);
    const target = path.join(worktreeRoot, relative);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(source);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    // A symlinked parent would let the copy escape the worktree; that is a
    // hard stop, not a skip.
    const parent = path.dirname(target);
    let insideWorktree = false;
    for (let probe = parent; ; probe = path.dirname(probe)) {
      if (probe === worktreeRoot) {
        insideWorktree = true;
        break;
      }
      const next = path.dirname(probe);
      if (next === probe) break;
    }
    if (!insideWorktree) {
      throw new ManagedWorktreeError(
        "a .worktreeinclude target resolves outside the worktree",
        "copy-failed",
        relative,
      );
    }
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
      throw new ManagedWorktreeError(
        "a .worktreeinclude target parent is a symlink",
        "copy-failed",
        relative,
      );
    }
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(source, target);
    copied += 1;
  }
  return copied;
}

/** Creates one managed worktree from a branch, tag or HEAD. */
export async function createManagedWorktree(options: {
  workspacePath: string;
  /** Branch, tag or sha; absent means the current HEAD (detached). */
  ref?: string;
}): Promise<ManagedWorktreeInfo> {
  // The ref arrives from the WebUI, so it must never be arguable: a ref
  // starting with "-" would be parsed by git as an option (argv injection)
  // once it is pushed onto the `worktree add` command line.
  if (options.ref && options.ref.startsWith("-")) {
    throw new ManagedWorktreeError(
      "a worktree ref must not start with '-'",
      "invalid-ref",
      options.ref,
    );
  }
  const context = await resolveContext(options.workspacePath);
  const root = managedRoot();
  fs.mkdirSync(root, { recursive: true });

  let worktreeRoot: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = path.join(root, bucket(), context.repoName);
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    const args = ["worktree", "add"];
    if (options.ref) args.push(candidate, options.ref);
    else args.push("--detach", candidate);
    try {
      await git(context.toplevel, args);
      worktreeRoot = candidate;
      break;
    } catch (error) {
      lastError = error;
      // A bucket collision only matters if the directory exists; a genuine
      // git failure (bad ref) must surface immediately.
      if (!fs.existsSync(candidate)) throw error;
    }
  }
  if (!worktreeRoot) {
    throw lastError instanceof Error
      ? lastError
      : new ManagedWorktreeError("worktree add failed", "git-failed");
  }

  let taskCwdPath: string;
  let copied: number;
  try {
    taskCwdPath = taskCwd(worktreeRoot, context);
    copied = await copyIgnoredFiles(context, worktreeRoot);
  } catch (error) {
    // The worktree is already registered in the source repo; a failed task cwd
    // or copy step must recycle it or the orphan is unremovable from the UI.
    await git(context.toplevel, [
      "worktree",
      "remove",
      "--force",
      worktreeRoot,
    ]).catch(() => undefined);
    await git(context.toplevel, ["worktree", "prune"]).catch(() => undefined);
    throw error;
  }
  logger.info("Managed worktree created", {
    worktreePath: taskCwdPath,
    ref: options.ref ?? "HEAD",
    copiedIgnoredFiles: copied,
  });

  let branch: string | undefined;
  if (options.ref) branch = options.ref;
  else {
    try {
      const { stdout } = await git(taskCwdPath, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      const name = stdout.trim();
      branch = name === "HEAD" ? undefined : name;
    } catch {
      branch = undefined;
    }
  }

  return {
    worktreePath: taskCwdPath,
    label: `${context.repoName} · ${path.basename(path.dirname(worktreeRoot))}`,
    ...(branch ? { branch } : {}),
  };
}

/** The managed root the CLI owns; a worktree is TNT's iff it sits under it. */
export function managedWorktreeRoot(): string {
  return managedRoot();
}

function isManagedPath(candidate: string): boolean {
  const root = managedRoot();
  const relative = path.relative(root, path.resolve(candidate));
  // Managed layout is <bucket>/<repoName>: exactly two segments under the root.
  return !relative.startsWith("..") && relative.split(path.sep).length === 2;
}

interface WorktreeListEntry {
  worktreePath: string;
  head?: string;
  branch?: string;
  detached?: boolean;
}

async function listWorktrees(sourceRepo: string): Promise<WorktreeListEntry[]> {
  const { stdout } = await git(sourceRepo, ["worktree", "list", "--porcelain"]);
  const entries: WorktreeListEntry[] = [];
  let current: WorktreeListEntry | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { worktreePath: line.slice("worktree ".length) };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (current && line === "detached") {
      current.detached = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** The managed worktrees of one source repository, newest directory first. */
export async function listManagedWorktrees(options: {
  workspacePath: string;
}): Promise<
  (ManagedWorktreeInfo & {
    dirty: boolean;
    head?: string;
    usedBySessions: number;
  })[]
> {
  const context = await resolveContext(options.workspacePath);
  const entries = await listWorktrees(context.toplevel);
  const result: (ManagedWorktreeInfo & {
    dirty: boolean;
    head?: string;
    usedBySessions: number;
  })[] = [];
  for (const entry of entries) {
    if (!isManagedPath(entry.worktreePath)) continue;
    let dirty = false;
    try {
      const { stdout } = await git(entry.worktreePath, [
        "status",
        "--porcelain",
      ]);
      dirty = stdout.trim() !== "";
    } catch {
      dirty = false;
    }
    result.push({
      worktreePath: entry.worktreePath,
      label: `${context.repoName} · ${path.basename(path.dirname(entry.worktreePath))}`,
      ...(entry.branch ? { branch: entry.branch } : {}),
      dirty,
      ...(entry.head ? { head: entry.head.slice(0, 7) } : {}),
      usedBySessions: countSessionsUnder(entry.worktreePath),
    });
  }
  return result.sort((left, right) =>
    left.worktreePath.localeCompare(right.worktreePath),
  );
}

function countSessionsUnder(worktreePath: string): number {
  const target = path.resolve(worktreePath).toLowerCase();
  return sessionStore
    .list({ includeSubagents: true, limit: 500 })
    .filter(
      (meta) =>
        typeof meta.workspaceDirectory === "string" &&
        path.resolve(meta.workspaceDirectory).toLowerCase() === target,
    ).length;
}

/**
 * Removes one managed worktree. A worktree with live sessions (or a dirty
 * tree, unless forced) refuses: the data is only in this directory.
 */
export async function removeManagedWorktree(options: {
  workspacePath: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const context = await resolveContext(options.workspacePath);
  if (!isManagedPath(options.worktreePath)) {
    throw new ManagedWorktreeError(
      "not a TNT-managed worktree",
      "not-a-repository",
      options.worktreePath,
    );
  }
  const used = countSessionsUnder(options.worktreePath);
  if (used > 0 && !options.force) {
    throw new ManagedWorktreeError(
      `${used} session(s) still use this worktree`,
      "git-failed",
      options.worktreePath,
    );
  }
  await git(context.toplevel, [
    "worktree",
    "remove",
    ...(options.force ? ["--force"] : []),
    options.worktreePath,
  ]);
  await git(context.toplevel, ["worktree", "prune"]).catch(() => undefined);
}

/** True when the composer header may offer the worktree checkbox. */
export async function managedWorktreeAvailable(
  workspacePath: string,
): Promise<boolean> {
  try {
    await resolveContext(workspacePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start-ref candidates for the worktree branch picker (ZCode §3.2):
 * current HEAD, local branches and remote-tracking refs. No fetch is performed.
 */
export interface ManagedWorktreeStartRefs {
  /** Current HEAD; branchName is null on a detached HEAD. Null with no commits. */
  head: { sha: string; branchName: string | null } | null;
  localBranches: string[];
  /** "origin/main" shape; symbolic "<remote>/HEAD" refs are excluded. */
  remoteBranches: string[];
}

export async function listStartRefs(options: {
  workspacePath: string;
}): Promise<ManagedWorktreeStartRefs | null> {
  const context = await resolveContext(options.workspacePath);
  let head: { sha: string; branchName: string | null } | null = null;
  const localBranches: string[] = [];
  const remoteBranches: string[] = [];

  try {
    const { stdout: headRaw } = await git(context.toplevel, [
      "rev-parse",
      "HEAD",
    ]);
    const sha = headRaw.trim();
    if (sha) {
      let branchName: string | null = null;
      try {
        const { stdout: branchRaw } = await git(context.toplevel, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        const name = branchRaw.trim();
        branchName = name === "HEAD" ? null : name;
      } catch {
        branchName = null;
      }
      head = { sha, branchName };
    }
  } catch {
    head = null;
  }

  try {
    const { stdout: localRaw } = await git(context.toplevel, [
      "branch",
      "--format=%(refname:short)",
    ]);
    localBranches.push(
      ...localRaw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    // No local branches; fine.
  }

  try {
    const { stdout: remoteRaw } = await git(context.toplevel, [
      "branch",
      "--remotes",
      "--format=%(refname:short)",
    ]);
    remoteBranches.push(
      ...remoteRaw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.endsWith("/HEAD")),
    );
  } catch {
    // No remote refs; fine.
  }

  return { head, localBranches, remoteBranches };
}
