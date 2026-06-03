/**
 * The repository's checkouts, and the move between them.
 *
 * Every tool and the system message read the process's working directory, so
 * a checkout is not a label but the place the agent works in. This module
 * reads that directory the way git does and moves it when asked.
 */
import path from "path";

import { t } from "../i18n/index.js";
import { listWorktrees, type WorktreeInfo } from "../utils/git.js";
import { canonicalPath } from "../utils/canonicalPath.js";

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
  const here = canonicalPath(process.cwd());

  const checkouts = listCheckouts();
  // The longest match wins: a checkout nested in another one is the closer
  // answer to "where am I working".
  const matches = checkouts
    .map((checkout) => ({ checkout, root: canonicalPath(checkout.path) }))
    .filter(
      (entry) =>
        entry.root !== "" &&
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
  const wanted = canonicalPath(target);
  const checkout = listCheckouts().find(
    (entry) => canonicalPath(entry.path) === wanted,
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
