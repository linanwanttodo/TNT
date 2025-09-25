import { execFileSync } from "child_process";
import { readFileSync } from "fs";

import { logger } from "../../utils/logger.js";

const MAX_DIFF_SIZE = 50 * 1024; // 50KB

/** One new file has no diff to keep it small, so it is capped on its own. */
const MAX_UNTRACKED_FILE_SIZE = 20 * 1024; // 20KB

export interface DiffContext {
  baseBranch: string;
  diff: string;
  changedFiles: string[];
  stat: string;
  truncated: boolean;
}

/**
 * What a review runs against. `base` is the branch diff against the
 * merge-base (plus the working tree); `uncommitted` is only the working tree
 * against HEAD, for reviewing work that is not committed yet; `commit` is one
 * commit on its own, for reviewing what a specific change did; `range` is any
 * git range the caller names, for a comparison none of the three describes.
 */
export type ReviewTarget =
  | { kind: "base"; base?: string }
  | { kind: "uncommitted" }
  | { kind: "commit"; ref: string }
  | { kind: "range"; spec: string };

/**
 * Resolves the CLI flags into the one target the diff is computed for. The
 * targets are exclusive: two of them would describe two different diffs, and
 * which one wins is not something the caller should have to guess.
 */
export function reviewTargetFromOptions(options: {
  base?: string;
  uncommitted?: boolean;
  commit?: string;
  range?: string;
}): ReviewTarget {
  const chosen = [
    options.base ? "--base" : undefined,
    options.uncommitted ? "--uncommitted" : undefined,
    options.commit ? "--commit" : undefined,
    options.range ? "--range" : undefined,
  ].filter((name): name is string => Boolean(name));
  if (chosen.length > 1) {
    throw new Error(`${chosen.join(" and ")} cannot be combined`);
  }

  if (options.commit) {
    return { kind: "commit", ref: options.commit };
  }
  if (options.range) {
    return { kind: "range", spec: options.range };
  }
  return options.uncommitted
    ? { kind: "uncommitted" }
    : { kind: "base", base: options.base };
}

/**
 * The worktree a target needs. A commit is reviewed as it stood, so the
 * working tree of the moment is not copied over it. A range is not pinned to
 * one tree at all - its right side is where the code stands now - so the
 * current state is the honest place to read from.
 */
export function worktreeOptionsForTarget(target: ReviewTarget): {
  ref?: string;
  includeWorkingTree?: boolean;
} {
  return target.kind === "commit"
    ? { ref: target.ref, includeWorkingTree: false }
    : {};
}

/**
 * Auto-detect the default branch (main/master) for the current repo.
 */
function detectDefaultBranch(): string {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    // refs/remotes/origin/main -> main
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: check if main or master exists
    try {
      execFileSync("git", ["rev-parse", "--verify", "main"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      return "main";
    } catch {
      try {
        execFileSync("git", ["rev-parse", "--verify", "master"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        return "master";
      } catch {
        return "main"; // Default fallback
      }
    }
  }
}

/**
 * git escapes non-ascii paths in its listings, and the escaped form is not a
 * path that can be opened again. Every listing this module reads back has to be
 * in the plain form, or a Chinese or accented file name is named and never read.
 */
const GIT_PLAIN_PATHS = ["-c", "core.quotepath=off"];

/**
 * Untracked work is the one thing `git diff` cannot see, and it is exactly what
 * a review of the working tree should judge: a file that exists only on disk
 * still gets read, run and shipped. Each is rendered as a new-file patch so the
 * reviewers treat it like any other addition, and a file that cannot be shown
 * is named instead of dropped without a word.
 */
function collectUntracked(): { paths: string[]; patch: string } {
  let listed: string;
  try {
    listed = execFileSync(
      "git",
      [...GIT_PLAIN_PATHS, "ls-files", "--others", "--exclude-standard"],
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    return { paths: [], patch: "" };
  }

  const paths = listed ? listed.split("\n") : [];
  const blocks: string[] = [];
  for (const file of paths) {
    let text: string;
    try {
      const raw = readFileSync(file);
      if (raw.includes(0)) {
        blocks.push(`--- /dev/null\n+++ b/${file}\n(binary file, not shown)\n`);
        continue;
      }
      text = raw.toString("utf-8");
    } catch {
      blocks.push(`--- /dev/null\n+++ b/${file}\n(could not be read)\n`);
      continue;
    }

    const cut = text.length > MAX_UNTRACKED_FILE_SIZE;
    const shown = cut ? text.slice(0, MAX_UNTRACKED_FILE_SIZE) : text;
    const lines = shown.split("\n");
    blocks.push(
      `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` +
        lines.map((line) => `+${line}`).join("\n") +
        "\n" +
        (cut ? "+(stopped: the file is larger than the review limit)\n" : ""),
    );
  }

  return { paths, patch: blocks.join("") };
}

/**
 * Runs one git form three ways: the patch, the file names, the stat. The form
 * differs by target - `diff <ref>` for a working-tree comparison, `show <ref>`
 * for a commit - but everything the reviewers consume is the same shape.
 */
function collectDiff(
  gitForm: string[],
  nameForm: string[],
  statForm: string[],
  includeUntracked = false,
): {
  diff: string;
  changedFiles: string[];
  stat: string;
  truncated: boolean;
} {
  let diff: string;
  try {
    diff = execFileSync("git", gitForm, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    diff = "";
  }

  const untracked = includeUntracked ? collectUntracked() : undefined;
  if (untracked?.patch) {
    diff = `${diff}${untracked.patch}`;
  }

  let truncated = false;
  if (diff.length > MAX_DIFF_SIZE) {
    diff = diff.slice(0, MAX_DIFF_SIZE);
    truncated = true;
  }

  let changedFiles: string[] = [];
  try {
    const fileList = execFileSync("git", [...GIT_PLAIN_PATHS, ...nameForm], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    changedFiles = fileList ? fileList.split("\n") : [];
  } catch {
    changedFiles = [];
  }
  if (untracked) {
    changedFiles = [...changedFiles, ...untracked.paths];
  }

  let stat = "";
  try {
    stat = execFileSync("git", statForm, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    stat = "";
  }
  if (untracked && untracked.paths.length > 0) {
    stat = [
      stat,
      `${untracked.paths.length} untracked (not counted in the numbers above)`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return { diff, changedFiles, stat, truncated };
}

/** The diff of the working tree against one ref. */
function collectDiffAgainst(againstRef: string, includeUntracked = false) {
  return collectDiff(
    ["diff", againstRef],
    ["diff", "--name-only", againstRef],
    ["diff", "--stat", againstRef],
    includeUntracked,
  );
}

/**
 * Computes the diff a review runs against.
 *
 * `base` (the default) diffs against the merge-base with the base branch, so
 * a diverged branch shows its own changes plus the working tree; HEAD is the
 * merge-base when the branch has not diverged, which is why a repo that never
 * branched behaves the same either way. `uncommitted` diffs the working tree
 * against HEAD only, for reviewing what is not committed yet. Both of those
 * include files git is not tracking, because a review of unfinished work that
 * skipped them would skip the newest thing in the tree. `commit` compares a
 * recorded state and leaves them out. `range` does too: whether its right side
 * is the working tree depends on how the spec is written (`a..b` never is,
 * `HEAD~3` is), and this layer deliberately does not learn git's range syntax
 * to decide, so the caller who wants untracked work in a review names the
 * working-tree target instead.
 */
export function computeDiffContext(
  target: ReviewTarget = { kind: "base" },
): DiffContext {
  if (target.kind === "uncommitted") {
    return { baseBranch: "HEAD", ...collectDiffAgainst("HEAD", true) };
  }

  if (target.kind === "commit") {
    // `show` covers what `diff <ref>^ <ref>` cannot: the commit that has no
    // parent, where the caret resolves to nothing and the diff would be empty.
    return {
      baseBranch: target.ref,
      ...collectDiff(
        ["show", "--format=", target.ref],
        ["show", "--format=", "--name-only", target.ref],
        ["show", "--format=", "--stat", target.ref],
      ),
    };
  }

  if (target.kind === "range") {
    // The spec is one argv element passed straight to git, so any range git
    // understands (`main...HEAD`, `HEAD~3`, `a..b`) works without this layer
    // learning git's syntax.
    return { baseBranch: target.spec, ...collectDiffAgainst(target.spec) };
  }

  const base = target.base || detectDefaultBranch();

  // Get the merge-base to handle diverged branches
  let mergeBase: string;
  try {
    mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    logger.warn(
      `Could not find merge-base with ${base}, falling back to direct diff`,
    );
    mergeBase = base;
  }

  return { baseBranch: base, ...collectDiffAgainst(mergeBase, true) };
}
