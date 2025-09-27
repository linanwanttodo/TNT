import chalk from "chalk";

import {
  isPromptProfile,
  PROMPT_PROFILES,
} from "../../../agent/promptProfiles.js";
import { t } from "../../../i18n/index.js";
import { enterPlanProfile } from "../../../permissions/planProfile.js";
import {
  getSessionPromptProfile,
  setSessionPromptProfile,
} from "../../../session/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * The profile is the task-shaped half of the mode story: it decides what the
 * agent has been asked to do, while the permission mode decides what the tools
 * may touch. `plan` is the one profile with a permission twin, so choosing it
 * here also enters plan mode - a plan that could still write code would not be
 * the thing the user asked for.
 */
export function handleProfile(args: string[] = []): SlashCommandResult {
  const requested = args.join(" ").trim().toLowerCase();

  if (!requested) {
    const current = getSessionPromptProfile();
    const lines = [
      current
        ? t("profile.current", { name: current })
        : t("profile.noneSelected"),
      "",
      t("profile.available"),
    ];
    for (const profile of PROMPT_PROFILES) {
      lines.push(`  ${chalk.cyan(profile)} - ${t(`profile.desc.${profile}`)}`);
    }
    lines.push("", chalk.dim(t("profile.usage")));
    return { output: lines.join("\n") };
  }

  if (
    requested === "clear" ||
    requested === "none" ||
    requested === "default"
  ) {
    setSessionPromptProfile(undefined);
    return { output: t("profile.cleared") };
  }

  if (!isPromptProfile(requested)) {
    return { output: t("profile.unknown", { name: requested }) };
  }

  if (requested === "plan") {
    enterPlanProfile();
    return {
      output: `${t("profile.set", { name: requested })} ${t("profile.enteredPlanMode")}`,
    };
  }

  setSessionPromptProfile(requested);
  return { output: t("profile.set", { name: requested }) };
}
