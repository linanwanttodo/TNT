import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import { buildImportSkillPrompt } from "../../../tools/skills.js";
import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "../../../utils/loadMarkdownSkills.js";
import type { SlashCommandResult } from "../types.js";

export async function handleSkills(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const { skills } = await loadMarkdownSkills();

  // "/skills <name>" runs the skill, the way the dispatch path does for a
  // bare "/<name>".
  const requested = args.join(" ").trim().toLowerCase();
  if (requested) {
    const match = skills.find(
      (skill) =>
        getSkillSlashCommandName(skill) === requested ||
        skill.name.trim().toLowerCase() === requested,
    );
    if (match) {
      return {
        newInput: `Load the skill using the **Skills** tool and then set the **skill_name** parameter to "${match.name}".`,
      };
    }
    return {
      exit: false,
      output: chalk.red(t("skills.unknown", { name: requested })),
    };
  }

  if (!skills.length) {
    return {
      exit: false,
      output: chalk.yellow(t("skills.none")),
    };
  }

  const header = chalk.bold(t("skills.header"));
  const lines = skills.map(
    (skill) =>
      `${chalk.cyan(skill.name)} - ${skill.description} ${chalk.gray(
        `(${skill.path})`,
      )}`,
  );

  return {
    exit: false,
    output: [header, "", ...lines].join("\n"),
  };
}

export async function handleImportSkill(
  args: string[],
): Promise<SlashCommandResult> {
  const query = args.join(" ").trim();

  if (!query) {
    return {
      exit: false,
      output: chalk.yellow(t("skills.importUsage")),
    };
  }

  return {
    newInput: buildImportSkillPrompt(query),
  };
}
