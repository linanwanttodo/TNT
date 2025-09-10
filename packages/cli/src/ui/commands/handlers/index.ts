import { handleInit } from "../../../commands/init.js";
import { t } from "../../../i18n/index.js";
import { handleInfoSlashCommand } from "../../../startup/infoScreen.js";
import type { CommandHandler } from "../types.js";

import { handleIndex } from "./codebaseIndex.js";
import { handleDiagnostics } from "./diagnostics.js";
import { handleHelp } from "./help.js";
import { handleLanguage } from "./language.js";
import { handleJobs, handleTodos } from "./misc.js";
import { handleOutputStyle } from "./outputStyle.js";
import { handlePlugins } from "./plugins.js";
import {
  handleBackToParent,
  handleFork,
  handleGoal,
  handleSessions,
  handleSubagents,
  handleTitle,
} from "./sessions.js";
import { handleExport, handleImport } from "./sessionTransfer.js";
import { handleImportSkill, handleSkills } from "./skills.js";

/**
 * Built-in commands that run in-process. Commands contributed by prompts,
 * rules, skills and plugins are resolved by name in the dispatcher instead.
 */
export function createCommandHandlers(): Record<string, CommandHandler> {
  return {
    help: handleHelp,
    clear: () => {
      return { clear: true, output: t("session.cleared") };
    },
    exit: () => {
      return { exit: true, output: t("session.goodbye") };
    },
    config: () => {
      return { openConfigSelector: true };
    },
    info: handleInfoSlashCommand,
    model: () => ({ openModelSelector: true }),
    compact: () => {
      return { compact: true };
    },
    mcp: () => {
      return { openMcpSelector: true };
    },
    resume: () => {
      return { openSessionSelector: true };
    },
    fork: handleFork,
    title: handleTitle,
    rename: handleTitle,
    goal: handleGoal,
    plugins: handlePlugins,
    "output-style": handleOutputStyle,
    diagnostics: (args) => handleDiagnostics(args),
    index: (args) => handleIndex(args),
    init: (args, assistant) => {
      return handleInit(args, assistant);
    },
    update: () => {
      return { openUpdateSelector: true };
    },
    jobs: handleJobs,
    todos: handleTodos,
    skills: () => handleSkills(),
    "import-skill": (args) => handleImportSkill(args),
    sessions: handleSessions,
    subagents: handleSubagents,
    back: handleBackToParent,
    parent: handleBackToParent,
    export: handleExport,
    import: handleImport,
    language: handleLanguage,
  };
}
