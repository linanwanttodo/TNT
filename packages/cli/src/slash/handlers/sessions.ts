import chalk from "chalk";

import { t } from "../../i18n/index.js";
import {
  getCurrentSession,
  getSessionGoal,
  listSubagentSessions,
  setSessionGoal,
  updateSessionTitle,
} from "../../session/index.js";
import type { SlashCommandResult } from "../types.js";

export async function handleFork(): Promise<SlashCommandResult> {
  try {
    const currentSession = getCurrentSession();
    const forkCommand = `tnt --fork ${currentSession.sessionId}`;
    // Try to copy to clipboard dynamically to avoid hard dependency in tests
    try {
      const clipboardy = await import("clipboardy");
      await clipboardy.default.write(forkCommand);
      return {
        exit: false,
        output: chalk.gray(`${forkCommand} (copied to clipboard)`),
      };
    } catch {
      return {
        exit: false,
        output: chalk.gray(`${forkCommand}`),
      };
    }
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(t("session.forkFailed", { error: error.message })),
    };
  }
}

export function handleTitle(args: string[]): SlashCommandResult {
  const title = args.join(" ").trim();
  if (!title) {
    return {
      exit: false,
      output: chalk.yellow(t("session.titleUsage")),
    };
  }

  try {
    updateSessionTitle(title);
    return {
      exit: false,
      output: chalk.green(t("session.titleUpdated", { title })),
    };
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(t("session.titleFailed", { error: error.message })),
    };
  }
}

export function handleGoal(args: string[]): SlashCommandResult {
  const goal = args.join(" ").trim();
  if (!goal) {
    const current = getSessionGoal();
    return {
      exit: false,
      output: current
        ? chalk.dim(t("session.currentGoal", { goal: current }))
        : chalk.yellow(t("session.goalUsage")),
    };
  }

  if (goal.toLowerCase() === "clear" || goal.toLowerCase() === "none") {
    setSessionGoal(undefined);
    return {
      exit: false,
      output: chalk.dim(t("session.goalCleared")),
    };
  }

  setSessionGoal(goal);
  return {
    exit: false,
    output: chalk.green(t("session.goalSet", { goal })),
  };
}

export function handleSessions(): SlashCommandResult {
  return { openSessionSelector: true };
}

export function handleSubagents(): SlashCommandResult {
  const parent = getCurrentSession();
  const children = listSubagentSessions(parent.sessionId);

  if (children.length === 0) {
    return {
      exit: false,
      output: chalk.dim(t("subagent.empty")),
    };
  }

  const lines = children.map((child) => {
    const label = child.subagentType ?? t("subagent.unlabeled");
    const preview = child.firstUserMessage
      ? ` - ${child.firstUserMessage.split("\n")[0]}`
      : "";
    return `  ${chalk.cyan(label)} ${chalk.dim(child.sessionId)}${preview}`;
  });

  return {
    exit: false,
    // The list is printed for headless runs; interactive runs also get a
    // picker so a delegated transcript can be opened directly.
    openSubagentsSelector: true,
    output: [
      chalk.bold(t("subagent.title", { count: children.length })),
      "",
      ...lines,
    ].join("\n"),
  };
}

export function handleBackToParent(): SlashCommandResult {
  const parentSessionId = getCurrentSession().parentSessionId;

  if (!parentSessionId) {
    return {
      exit: false,
      output: chalk.dim(t("subagent.noParent")),
    };
  }

  return { exit: false, loadSessionId: parentSessionId };
}
