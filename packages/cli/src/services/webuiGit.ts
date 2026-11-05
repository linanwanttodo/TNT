import { execFileSync } from "child_process";

import { currentCheckout } from "./worktreeCatalog.js";

export interface WebUiGitStatus {
  repo: boolean;
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  dirty: boolean;
  changedFiles: number;
  changes: Array<{ path: string; status: string; staged: boolean }>;
  latestCommit: { hash: string; subject: string } | null;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/**
 * The facts the top status menu shows: checkout, branch, HEAD, the latest
 * commit and whether the working tree has changes.
 */
export function getWebUiGitStatus(): WebUiGitStatus {
  const checkout = currentCheckout();
  if (!checkout) {
    return {
      repo: false,
      path: process.cwd(),
      branch: null,
      head: "",
      detached: false,
      dirty: false,
      changedFiles: 0,
      changes: [],
      latestCommit: null,
    };
  }

  let changes: WebUiGitStatus["changes"] = [];
  try {
    changes = git(["status", "--porcelain=v1", "-z"])
      .split("\0")
      .filter((entry) => entry.trim() !== "")
      .map((entry) => {
        const status = entry.slice(0, 2);
        const file = entry.slice(3).split(" -> ").pop() ?? entry.slice(3);
        const staged = status[0] !== " " && status[0] !== "?";
        const kind = status.includes("?")
          ? "untracked"
          : status.includes("D")
            ? "deleted"
            : status.includes("R")
              ? "renamed"
              : "modified";
        return { path: file, status: kind, staged };
      });
  } catch {
    changes = [];
  }

  let latestCommit: WebUiGitStatus["latestCommit"] = null;
  try {
    const [hash, subject] = git(["log", "-1", "--format=%h%x00%s"]).split(
      "\u0000",
    );
    if (hash) {
      latestCommit = { hash, subject: subject ?? "" };
    }
  } catch {
    latestCommit = null;
  }

  return {
    repo: true,
    path: checkout.path,
    branch: checkout.branch,
    head: checkout.head,
    detached: checkout.detached,
    dirty: changes.length > 0,
    changedFiles: changes.length,
    changes,
    latestCommit,
  };
}
