import chalk from "chalk";

import { buildImportSkillPrompt } from "../../tools/skills.js";
import { loadMarkdownSkills } from "../../util/loadMarkdownSkills.js";
import type { SlashCommandResult } from "../types.js";

export async function handleSkills(): Promise<SlashCommandResult> {
  const { skills } = await loadMarkdownSkills();

  if (!skills.length) {
    return {
      exit: false,
      output: chalk.yellow(
        "No skills found. Add skills under .tnt/skills or .claude/skills.",
      ),
    };
  }

  const header = chalk.bold("Available skills:");
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
      output: chalk.yellow(
        "Please provide a skill URL or name. Usage: /import-skill <url-or-name>",
      ),
    };
  }

  return {
    newInput: buildImportSkillPrompt(query),
  };
}
