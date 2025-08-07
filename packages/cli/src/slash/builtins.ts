import { t, type TranslationKey } from "../i18n/index.js";
import type { SlashCommand, SystemCommand } from "./types.js";

/**
 * A built-in command carries an i18n key instead of literal text, so a locale
 * change is picked up the next time the command list is built.
 */
export interface BuiltinCommandSpec {
  name: string;
  descriptionKey: TranslationKey;
}

export const BUILTIN_SLASH_COMMANDS: BuiltinCommandSpec[] = [
  { name: "help", descriptionKey: "cmd.help" },
  { name: "clear", descriptionKey: "cmd.clear" },
  { name: "update", descriptionKey: "cmd.update" },
  { name: "info", descriptionKey: "cmd.info" },
  { name: "model", descriptionKey: "cmd.model" },
  { name: "config", descriptionKey: "cmd.config" },
  { name: "mcp", descriptionKey: "cmd.mcp" },
  { name: "init", descriptionKey: "cmd.init" },
  { name: "compact", descriptionKey: "cmd.compact" },
  { name: "resume", descriptionKey: "cmd.resume" },
  { name: "fork", descriptionKey: "cmd.fork" },
  { name: "title", descriptionKey: "cmd.title" },
  { name: "goal", descriptionKey: "cmd.goal" },
  { name: "plugins", descriptionKey: "cmd.plugins" },
  { name: "rename", descriptionKey: "cmd.rename" },
  { name: "exit", descriptionKey: "cmd.exit" },
  { name: "jobs", descriptionKey: "cmd.jobs" },
  { name: "sessions", descriptionKey: "cmd.sessions" },
  { name: "subagents", descriptionKey: "cmd.subagents" },
  { name: "back", descriptionKey: "cmd.back" },
  { name: "skills", descriptionKey: "cmd.skills" },
  { name: "import-skill", descriptionKey: "cmd.importSkill" },
  { name: "export", descriptionKey: "cmd.export" },
  { name: "import", descriptionKey: "cmd.import" },
  { name: "language", descriptionKey: "language.title" },
];

export const REMOTE_MODE_SLASH_COMMANDS: BuiltinCommandSpec[] = [
  { name: "exit", descriptionKey: "cmd.exit" },
  { name: "diff", descriptionKey: "cmd.diff" },
  { name: "apply", descriptionKey: "cmd.apply" },
];

export function toSystemCommand(spec: BuiltinCommandSpec): SystemCommand {
  return {
    name: spec.name,
    description: t(spec.descriptionKey),
    category: "system",
  };
}

/**
 * Replaces a built-in command description with its translation, leaving
 * commands that carry their own text (plugins, skills, prompts) untouched.
 */
export function translateCommandDescription(
  command: SlashCommand,
  keys: Record<string, TranslationKey> = BUILTIN_DESCRIPTION_KEYS,
): SlashCommand {
  const key = keys[command.name];

  return key ? { ...command, description: t(key) } : command;
}

export const BUILTIN_DESCRIPTION_KEYS: Record<string, TranslationKey> =
  Object.fromEntries(
    BUILTIN_SLASH_COMMANDS.map((spec) => [spec.name, spec.descriptionKey]),
  );
