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
 * against HEAD, for reviewing work that is not committed yet.
 */
export type ReviewTarget =
  | { kind: "base"; base?: string }
  | { kind: "uncommitted" };

/** Resolves the CLI flags into the one target the diff is computed for. */
export function reviewTargetFromOptions(options: {
  base?: string;
  uncommitted?: boolean;
}): ReviewTarget {
  return options.uncommitted
    ? { kind: "uncommitted" }
    : { kind: "base", base: options.base };
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

/** The diff against one ref, in the shape the reviewers consume. */
function collectDiff(againstRef: string): {
  diff: string;
  changedFiles: string[];
  stat: string;
  truncated: boolean;
} {
  let diff: string;
  try {
    diff = execFileSync("git", ["diff", againstRef], {
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
    const fileList = execFileSync("git", ["diff", "--name-only", againstRef], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    changedFiles = fileList ? fileList.split("\n") : [];
  } catch {
    changedFiles = [];
  }

  let stat = "";
  try {
    stat = execFileSync("git", ["diff", "--stat", againstRef], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    stat = "";
  }

  return { diff, changedFiles, stat, truncated };
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
    return { baseBranch: "HEAD", ...collectDiff("HEAD") };
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

  return { baseBranch: base, ...collectDiff(mergeBase) };
}
