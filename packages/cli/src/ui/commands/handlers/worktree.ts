import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import {
  createManagedWorktree,
  listManagedWorktrees,
  managedWorktreeAvailable,
  removeManagedWorktree,
} from "../../../webuiZcode/services/managedWorktree.js";

/**
 * `/worktree` — list, create and remove managed worktrees from the CLI.
 *
 * The WebUI composer header has a checkbox; the CLI offers the same three
 * operations through this slash command so the feature is not web-only.
 * Worktrees are TNT-managed (under `~/.tnt/worktrees/`), created from a
 * branch/tag/HEAD, and their directory is the session cwd.
 */
export async function handleWorktree(
  args: string[] = [],
): Promise<{ output?: string }> {
  const workspacePath = process.cwd();

  if (!(await managedWorktreeAvailable(workspacePath))) {
    return {
      output: chalk.dim(t("worktree.notGitRepository")),
    };
  }

  const action = args[0];

  if (action === "create" || action === "add") {
    const ref = args[1] || undefined;
    try {
      const created = await createManagedWorktree({
        workspacePath,
        ...(ref ? { ref } : {}),
      });
      const refNote = ref ? ` (from ${ref})` : " (from HEAD)";
      return {
        output: [
          chalk.green(t("worktree.created", { path: created.worktreePath })),
          chalk.dim(`${created.label}${refNote}`),
          chalk.dim(t("worktree.startHint", { path: created.worktreePath })),
        ].join("\n"),
      };
    } catch (error) {
      return {
        output: t("worktree.createFailed", {
          message: (error as Error).message,
        }),
      };
    }
  }

  if (action === "remove" || action === "rm") {
    const target = args[1];
    if (!target) {
      return { output: t("worktree.removeUsage") };
    }
    const force = args.includes("--force");
    try {
      await removeManagedWorktree({
        workspacePath,
        worktreePath: target,
        ...(force ? { force: true } : {}),
      });
      return { output: t("worktree.removed", { path: target }) };
    } catch (error) {
      return {
        output: t("worktree.removeFailed", {
          message: (error as Error).message,
        }),
      };
    }
  }

  // No recognized action → list managed worktrees.
  const worktrees = await listManagedWorktrees({ workspacePath });
  const lines: string[] = [];

  if (worktrees.length === 0) {
    lines.push(chalk.dim(t("worktree.empty")));
    lines.push(chalk.dim(t("worktree.createHint")));
  } else {
    lines.push(
      chalk.bold(t("worktree.listHeader", { count: worktrees.length })),
    );
    lines.push("");
    for (const entry of worktrees) {
      const branch = entry.branch ? ` [${entry.branch}]` : "";
      const dirty = entry.dirty ? chalk.yellow(` ${t("worktree.dirty")}`) : "";
      const sessions =
        entry.usedBySessions > 0
          ? chalk.dim(
              ` ${t("worktree.sessions", { count: entry.usedBySessions })}`,
            )
          : "";
      lines.push(
        `  ${chalk.cyan(entry.worktreePath)}${branch}${dirty}${sessions}`,
      );
    }
    lines.push("");
    lines.push(chalk.dim(t("worktree.removeHint")));
  }
  return { output: lines.join("\n") };
}
