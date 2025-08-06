import { type AssistantConfig } from "@tnt/sdk";

import { loadAllPlugins } from "../plugins/loader.js";
import { logger } from "../util/logger.js";
import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "../util/loadMarkdownSkills.js";
import { type TranslationKey, t } from "../i18n/index.js";

// Export command functions
export { chat } from "./chat.js";
export { listSessionsCommand } from "./ls.js";
export { review } from "./review.js";
export { serve } from "./serve.js";

export interface SlashCommand {
  name: string;
  description: string;
  category: "system" | "assistant";
}

export interface SystemCommand extends SlashCommand {
  category: "system";
}

// Central definition of all system slash commands
export const SYSTEM_SLASH_COMMANDS: SystemCommand[] = [
  {
    name: "help",
    description: "Show help message",
    category: "system",
  },
  {
    name: "clear",
    description: "Clear the chat history",
    category: "system",
  },
  {
    name: "update",
    description: "Update the TNT",
    category: "system",
  },
  {
    name: "info",
    description: "Show session information",
    category: "system",
  },
  {
    name: "model",
    description: "Switch between available chat models",
    category: "system",
  },
  {
    name: "config",
    description: "Switch configuration",
    category: "system",
  },
  {
    name: "mcp",
    description: "Manage MCP server connections",
    category: "system",
  },
  {
    name: "init",
    description: "Create an AGENTS.md file",
    category: "system",
  },
  {
    name: "compact",
    description: "Summarize chat history into a compact form",
    category: "system",
  },
  {
    name: "resume",
    description: "Resume a previous chat session",
    category: "system",
  },
  {
    name: "fork",
    description: "Start a forked chat session from the current history",
    category: "system",
  },
  {
    name: "title",
    description: "Set the title for the current session",
    category: "system",
  },
  {
    name: "goal",
    description: "Set the goal for the current session",
    category: "system",
  },
  {
    name: "plugins",
    description: "List installed plugins and what they contribute",
    category: "system",
  },
  {
    name: "rename",
    description: "Rename the current session",
    category: "system",
  },
  {
    name: "exit",
    description: "Exit the chat",
    category: "system",
  },
  {
    name: "jobs",
    description: "List background jobs",
    category: "system",
  },
  {
    name: "sessions",
    description: "Show all chat sessions",
    category: "system",
  },
  {
    name: "subagents",
    description: "Show sessions delegated from the current one",
    category: "system",
  },
  {
    name: "back",
    description: "Return from a delegated session to its parent",
    category: "system",
  },
  {
    name: "skills",
    description: "List all available skills",
    category: "system",
  },
  {
    name: "import-skill",
    description: "Import a skill from a URL or name into ~/.tnt/skills",
    category: "system",
  },
  {
    name: "export",
    description: "Export a session to JSON file",
    category: "system",
  },
  {
    name: "import",
    description: "Import a session from JSON file",
    category: "system",
  },
  {
    name: "language",
    description: "Switch the CLI display language",
    category: "system",
  },
];

export const REMOTE_MODE_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "exit",
    description: "Exit the remote environment",
    category: "system",
  },
  {
    name: "diff",
    description: "Show the current diff from the remote environment",
    category: "system",
  },
  {
    name: "apply",
    description: "Apply the current diff to the local working tree",
    category: "system",
  },
];

/**
 * i18n keys for the built-in command descriptions. The lists above are module
 * constants, so the text is resolved when a list is read rather than when the
 * module loads; a locale change then takes effect as soon as the list is
 * rebuilt.
 */
const COMMAND_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  help: "cmd.help",
  clear: "cmd.clear",
  update: "cmd.update",
  info: "cmd.info",
  model: "cmd.model",
  config: "cmd.config",
  mcp: "cmd.mcp",
  init: "cmd.init",
  compact: "cmd.compact",
  resume: "cmd.resume",
  fork: "cmd.fork",
  title: "cmd.title",
  goal: "cmd.goal",
  plugins: "cmd.plugins",
  rename: "cmd.rename",
  exit: "cmd.exit",
  jobs: "cmd.jobs",
  sessions: "cmd.sessions",
  subagents: "cmd.subagents",
  back: "cmd.back",
  skills: "cmd.skills",
  "import-skill": "cmd.importSkill",
  export: "cmd.export",
  import: "cmd.import",
  language: "language.title",
  diff: "cmd.diff",
  apply: "cmd.apply",
};

/**
 * Replaces a built-in command description with its translation, leaving
 * commands that carry their own text (plugins, skills, prompts) untouched.
 */
function translateCommandDescription(command: SlashCommand): SlashCommand {
  const key = COMMAND_DESCRIPTION_KEYS[command.name];

  return key ? { ...command, description: t(key) } : command;
}

/**
 * Get all available slash commands including system commands and assistant prompts
 */
export async function getAllSlashCommands(
  assistant: AssistantConfig,
  options: { isRemoteMode?: boolean } = {},
): Promise<SlashCommand[]> {
  const { isRemoteMode = false } = options;

  // In remote mode, only show the exit command
  if (isRemoteMode) {
    return REMOTE_MODE_SLASH_COMMANDS.map(translateCommandDescription);
  }

  // All system commands are available
  const systemCommands = SYSTEM_SLASH_COMMANDS.map(translateCommandDescription);

  // Get assistant prompt commands
  const assistantCommands: SlashCommand[] =
    assistant?.prompts?.map((prompt) => ({
      name: prompt?.name || "",
      description: prompt?.description || "",
      category: "assistant" as const,
    })) || [];

  // Get invokable rule commands
  const invokableRuleCommands = getInvokableRuleSlashCommands(assistant);

  // Get skill commands
  const skillCommands = await getSkillSlashCommands();

  const pluginCommands = getPluginSlashCommands();

  return [
    ...systemCommands,
    ...assistantCommands,
    ...invokableRuleCommands,
    ...skillCommands,
    ...pluginCommands,
  ];
}

/**
 * Get assistant prompt commands only
 */
export function getAssistantSlashCommands(
  assistant: AssistantConfig,
): SlashCommand[] {
  return (
    assistant?.prompts?.map((prompt) => ({
      name: prompt?.name || "",
      description: prompt?.description || "",
      category: "assistant" as const,
    })) || []
  );
}

/**
 * Get invokable rule commands from assistant config
 */
export function getInvokableRuleSlashCommands(
  assistant: AssistantConfig,
): SlashCommand[] {
  if (!assistant?.rules) {
    return [];
  }

  return assistant.rules
    .filter((rule) => {
      // Handle both string rules and rule objects
      if (!rule || typeof rule === "string") {
        return false;
      }
      // Only include rules with invokable: true
      return rule.invokable === true;
    })
    .map((rule) => {
      // TypeScript now knows rule is an object with invokable: true
      const ruleObj = rule as any;
      return {
        name: ruleObj.name || "",
        description: ruleObj.description || "",
        category: "assistant" as const,
      };
    });
}

/**
 * Get skill-based slash commands from Markdown skills
 */
export async function getSkillSlashCommands(): Promise<SlashCommand[]> {
  const { skills } = await loadMarkdownSkills();

  return skills.map((skill) => ({
    name: getSkillSlashCommandName(skill),
    description: skill.description,
    category: "assistant" as const,
  }));
}

/**
 * Commands contributed by installed plugins, namespaced as plugin:command.
 */
export function getPluginSlashCommands(): SlashCommand[] {
  try {
    return loadAllPlugins().commands.map((command) => ({
      name: command.name,
      description: command.description,
      category: "assistant" as const,
    }));
  } catch (error) {
    logger.warn("Failed to load plugin commands:", error);
    return [];
  }
}
