import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import { loadMarkdownSkills } from "../utils/loadMarkdownSkills.js";
import { logger } from "../utils/logger.js";

import { readFileTool } from "./readFile.js";
import { Tool } from "./types.js";

/**
 * The rules that decide whether a skill call is worth making. They live here
 * rather than in the system prompt because the model reads them at the moment it
 * picks this call, and the skill registry below is the same static text for the
 * whole session, so the cached prompt prefix survives it.
 */
export const SKILLS_INTRO = `Read a skill before starting the task it describes, not after the attempt has gone wrong: the skill is the procedure to follow, not background reading.
The skill name has to be one of the skills listed below. A name you invent fails and costs the turn, because the answer is only the list this run has.
A skill you already read in this session does not need reading again; its text is still in the conversation. When a skill ships extra files, the result names them and you open them with Read.`;

export const SKILLS_TOOL_META: Tool = {
  name: "Skills",
  displayName: "Skills",
  description: SKILLS_INTRO,
  // Reading a skill changes nothing in the project, and the policy coverage
  // guard uses this flag to insist a read-only tool stays allowed in both modes.
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["skill_name"],
    properties: {
      skill_name: {
        type: "string",
        description:
          "The name of the skill to read. This should match the name from the available skills.",
      },
    },
  },
  run: async () => "",
};

export const skillsTool = async (): Promise<Tool> => {
  const { skills } = await loadMarkdownSkills();

  return {
    ...SKILLS_TOOL_META,

    description: `${SKILLS_INTRO}
${
  skills.length > 0
    ? skills
        .map(
          (skill) =>
            `\nname: ${skill.name}\ndescription: ${skill.description}\n`,
        )
        .join("")
    : "No skills are installed for this workspace, so there is nothing for this tool to read."
}`,
    run: async (args: any, context?: { toolCallId: string }) => {
      const { skill_name } = args;

      logger.debug("skill args", { args, context });

      const skill = skills.find((sk) => sk.name === skill_name);
      if (!skill) {
        const availableSkills = skills.map((sk) => sk.name).join(", ");
        throw new ContinueError(
          ContinueErrorReason.SkillNotFound,
          `Skill "${skill_name}" not found. Available skills: ${availableSkills || "none"}`,
        );
      }

      const content = [
        `<skill_name>${skill.name}</skill_name>`,
        `<skill_description>${skill.description}</skill_description>`,
        `<skill_content>${skill.content}</skill_content>`,
      ];

      if (skill.files.length > 0) {
        content.push(
          `<skill_files>${skill.files.join(",")}</skill_files>`,
          `<other_instructions>Use the ${readFileTool.name} tool to access skill files as needed.</other_instructions>`,
        );
      }

      return content.join("\n");
    },

    preprocess: async (args: any) => {
      const { skill_name } = args;

      return {
        args,
        preview: [
          {
            type: "text",
            content: `Reading skill: ${skill_name}`,
          },
        ],
      };
    },
  };
};

export function buildImportSkillPrompt(identifier: string): string {
  return `
# Overview

The user wants to import skills.

User-provided skill identifier:
${identifier}

# Guidelines
- There can be multiple skills in a single repository.
- Use the available tools to fetch content and write files. When you are done, briefly summarize which skill you imported and where you saved it.
- Use the "AskQuestion" tool where required to clarify with the user.

# Process:

**Identifier can either be a URL or a skill name**

- If it looks like a URL (for example, it starts with http:// or https://), open that URL and inspect its contents to find the code or files that define the skill. 
- If the URL is a GitHub repository, look for the skills folder. There can be multiple skills within subdirectories.
- If it looks like a skill name, you should search for the most relevant open-source skill or repository that matches the skill identifier.
- Ask questions to the user to clarify which skill they are referring to if there are multiple options in your findings.

**Create the skill files**

- The skills should be created under the directory: ~/.tnt/skills/<skill-name>
- The subdirectory name should match the name of the skill directory in the fetched repository.
- The relevant files and folders along with SKILL.md should be present inside the created skill subdirectory.
- If the skill already exists, ask question to the user to clarify whether they want to update it.
- Important: Before writing any files, ask the user if they want to proceed with the import.
`;
}
