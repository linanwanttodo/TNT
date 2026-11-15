import { ToolImpl } from ".";
import { loadMarkdownSkills } from "../../config/markdown/loadMarkdownSkills";
import { TntError, TntErrorReason } from "../../util/errors";
import { getStringArg } from "../parseArgs";

export const readSkillImpl: ToolImpl = async (args, extras) => {
  const skillName = getStringArg(args, "skillName");

  const { skills } = await loadMarkdownSkills(extras.ide);

  const skill = skills.find((s) => s.name === skillName);

  if (!skill) {
    const availableSkills = skills.map((s) => s.name).join(", ");
    throw new TntError(
      TntErrorReason.SkillNotFound,
      `Skill "${skillName}" not found. Available skills: ${availableSkills || "none"}`,
    );
  }

  let content = skill.content;

  if (skill.files.length > 0) {
    content += `\n
## Supporting files
Skill directory:
${skill.files.join("\n")}

Use the read file tool to access these files as needed.`;
  }

  return [
    {
      name: `Skill: ${skill.name}`,
      description: skill.description,
      content,
      uri: {
        type: "file",
        value: skill.path,
      },
    },
  ];
};
