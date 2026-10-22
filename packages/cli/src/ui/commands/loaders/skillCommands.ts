import { t } from "../../../i18n/index.js";
import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "../../../utils/loadMarkdownSkills.js";
import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

/**
 * Skills live under one parent command instead of flooding the first level:
 * `/skills` opens the list, `/skills <name>` runs one. The dispatch path still
 * accepts a bare `/skill-name`.
 */
export class SkillCommandLoader implements CommandLoader {
  readonly source = "skill" as const;

  async loadCommands(_context: CommandLoadContext): Promise<SlashCommand[]> {
    const { skills } = await loadMarkdownSkills();

    return [
      {
        name: "skills",
        description: t("cmd.skills"),
        category: "system" as const,
        ...(skills.length
          ? {
              subcommands: skills.map((skill) => ({
                name: getSkillSlashCommandName(skill),
                description: skill.description,
              })),
            }
          : {}),
      },
    ];
  }
}
