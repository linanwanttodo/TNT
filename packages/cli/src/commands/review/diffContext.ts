import { execFileSync } from "child_process";

import { logger } from "../../utils/logger.js";

const MAX_DIFF_SIZE = 50 * 1024; // 50KB

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
 * Runs one git form three ways: the patch, the file names, the stat. The form
 * differs by target - `diff <ref>` for a working-tree comparison, `show <ref>`
 * for a commit - but everything the reviewers consume is the same shape.
 */
function collectDiff(
  gitForm: string[],
  nameForm: string[],
  statForm: string[],
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

  let truncated = false;
  if (diff.length > MAX_DIFF_SIZE) {
    diff = diff.slice(0, MAX_DIFF_SIZE);
    truncated = true;
  }

  let changedFiles: string[] = [];
  try {
    const fileList = execFileSync("git", nameForm, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    changedFiles = fileList ? fileList.split("\n") : [];
  } catch {
    changedFiles = [];
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

  return { diff, changedFiles, stat, truncated };
}

/** The diff of the working tree against one ref. */
function collectDiffAgainst(againstRef: string) {
  return collectDiff(
    ["diff", againstRef],
    ["diff", "--name-only", againstRef],
    ["diff", "--stat", againstRef],
  );
}

/**
 * Computes the diff a review runs against.
 *
 * `base` (the default) diffs against the merge-base with the base branch, so
 * a diverged branch shows its own changes plus the working tree; HEAD is the
 * merge-base when the branch has not diverged, which is why a repo that never
 * branched behaves the same either way. `uncommitted` diffs the working tree
 * against HEAD only, for reviewing what is not committed yet.
 */
export function computeDiffContext(
  target: ReviewTarget = { kind: "base" },
): DiffContext {
  if (target.kind === "uncommitted") {
    return { baseBranch: "HEAD", ...collectDiffAgainst("HEAD") };
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

  return { baseBranch: base, ...collectDiffAgainst(mergeBase) };
}
