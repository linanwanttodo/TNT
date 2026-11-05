/**
 * The repository's checkouts, and the move between them.
 *
 * Every tool and the system message read the process's working directory, so
 * a checkout is not a label but the place the agent works in. This module
 * reads that directory the way git does and moves it when asked.
 */
import fs from "fs";
import path from "path";

import { t } from "../i18n/index.js";
import { listWorktrees, type WorktreeInfo } from "../utils/git.js";

/**
 * The real path of a directory, or null when it cannot be read.
 * @param target - the directory to resolve.
 * @returns the resolved path, or null.
 */
function realPath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/**
 * Every checkout of the repository the process is standing in.
 * @returns the checkouts, empty when the process is not in a repository.
 */
export function listCheckouts(): WorktreeInfo[] {
  return listWorktrees(process.cwd());
}

/**
 * The checkout the process is standing in: the one whose directory contains
 * it. A process in a subdirectory of a checkout still belongs to it.
 * @returns the checkout, or null when the process is not in a repository.
 */
export function currentCheckout(): WorktreeInfo | null {
  const here = realPath(process.cwd());
  if (!here) return null;

  const checkouts = listCheckouts();
  // The longest match wins: a checkout nested in another one is the closer
  // answer to "where am I working".
  const matches = checkouts
    .map((checkout) => ({ checkout, root: realPath(checkout.path) }))
    .filter(
      (entry): entry is { checkout: WorktreeInfo; root: string } =>
        entry.root !== null &&
        (here === entry.root || here.startsWith(entry.root + path.sep)),
    )
    .sort((a, b) => b.root.length - a.root.length);

  return matches[0]?.checkout ?? null;
}

/**
 * Move the process into another checkout of the same repository.
 * @param target - the checkout's path.
 * @returns the checkout the process now works in.
 * @throws when the path is not one of the repository's checkouts, or the
 * directory cannot be entered.
 */
export function moveToCheckout(target: string): WorktreeInfo {
  const wanted = realPath(target);
  const checkout = listCheckouts().find(
    (entry) => realPath(entry.path) === wanted,
  );
  if (!checkout) {
    throw new Error(t("services.noWorktreeAt", { path: target }));
  }

  try {
    process.chdir(checkout.path);
  } catch (error) {
    throw new Error(
      t("services.cannotEnterWorktree", {
        path: checkout.path,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return checkout;
}
