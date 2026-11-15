import {
  LOCALES,
  LOCALE_LABELS,
  t,
  type TranslationKey,
} from "../../i18n/index.js";

import type { SlashCommand, SystemCommand } from "./types.js";

/**
 * A built-in command carries an i18n key instead of literal text, so a locale
 * change is picked up the next time the command list is built.
 */
export interface BuiltinCommandSpec {
  name: string;
  descriptionKey: TranslationKey;
  subcommands?: Array<{ name: string; description: string }>;
}

export const BUILTIN_SLASH_COMMANDS: BuiltinCommandSpec[] = [
  { name: "help", descriptionKey: "cmd.help" },
  { name: "clear", descriptionKey: "cmd.clear" },
  { name: "update", descriptionKey: "cmd.update" },
  { name: "theme", descriptionKey: "cmd.theme" },
  { name: "info", descriptionKey: "cmd.info" },
  { name: "model", descriptionKey: "cmd.model" },
  { name: "brief", descriptionKey: "cmd.brief" },
  {
    name: "think",
    descriptionKey: "cmd.think",
    // The depth is a fixed vocabulary, so the palette completes it: typing
    // `/think ` and Tab is how a reader switches without guessing the words.
    subcommands: [
      { name: "off", description: t("thought.level.off") },
      { name: "low", description: t("thought.level.low") },
      { name: "medium", description: t("thought.level.medium") },
      { name: "high", description: t("thought.level.high") },
      { name: "xhigh", description: t("thought.level.xhigh") },
      { name: "max", description: t("thought.level.max") },
      { name: "default", description: t("think.default") },
    ],
  },
  {
    name: "mcp",
    descriptionKey: "cmd.mcp",
    subcommands: [
      { name: "list", description: t("mcp.sub.list") },
      { name: "market", description: t("mcp.sub.market") },
      { name: "search", description: t("mcp.sub.search") },
      { name: "install", description: t("mcp.sub.install") },
    ],
  },
  { name: "init", descriptionKey: "cmd.init" },
  { name: "compact", descriptionKey: "cmd.compact" },
  { name: "resume", descriptionKey: "cmd.resume" },
  { name: "fork", descriptionKey: "cmd.fork" },
  { name: "title", descriptionKey: "cmd.title" },
  { name: "goal", descriptionKey: "cmd.goal" },
  { name: "plugins", descriptionKey: "cmd.plugins" },
  { name: "plugin", descriptionKey: "cmd.plugins" },
  { name: "output-style", descriptionKey: "cmd.outputStyle" },
  { name: "team", descriptionKey: "cmd.team" },
  { name: "loop", descriptionKey: "cmd.loop" },
  { name: "ide", descriptionKey: "cmd.ide" },
  { name: "diagnostics", descriptionKey: "cmd.diagnostics" },
  { name: "index", descriptionKey: "cmd.index" },
  { name: "rename", descriptionKey: "cmd.rename" },
  { name: "exit", descriptionKey: "cmd.exit" },
  { name: "jobs", descriptionKey: "cmd.jobs" },
  { name: "cost", descriptionKey: "cmd.cost" },
  { name: "webui", descriptionKey: "cmd.webui" },
  { name: "sessions", descriptionKey: "cmd.sessions" },
  { name: "subagents", descriptionKey: "cmd.subagents" },
  { name: "back", descriptionKey: "cmd.back" },
  { name: "parent", descriptionKey: "cmd.parent" },
  { name: "todos", descriptionKey: "cmd.todos" },
  { name: "profile", descriptionKey: "cmd.profile" },
  { name: "import-skill", descriptionKey: "cmd.importSkill" },
  { name: "export", descriptionKey: "cmd.export" },
  { name: "import", descriptionKey: "cmd.import" },
  {
    name: "language",
    descriptionKey: "language.title",
    subcommands: LOCALES.map((locale) => ({
      name: locale,
      description: LOCALE_LABELS[locale],
    })),
  },
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
    ...(spec.subcommands ? { subcommands: spec.subcommands } : {}),
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
