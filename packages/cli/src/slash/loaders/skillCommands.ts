import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "../../utils/loadMarkdownSkills.js";
import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

export class SkillCommandLoader implements CommandLoader {
  readonly source = "skill" as const;

  async loadCommands(_context: CommandLoadContext): Promise<SlashCommand[]> {
    const { skills } = await loadMarkdownSkills();

    return skills.map((skill) => ({
      name: getSkillSlashCommandName(skill),
      description: skill.description,
      category: "assistant" as const,
    }));
  }
}
