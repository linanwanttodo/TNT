import fs from "fs";

import { type AssistantConfig } from "@tnt/sdk";
import chalk from "chalk";
import type { Session } from "core/index.js";
import historyManager from "core/util/history.js";
import { v4 as uuidv4 } from "uuid";

import { getAllSlashCommands } from "./commands/commands.js";
import { handleInit } from "./commands/init.js";
import {
  LOCALES,
  LOCALE_LABELS,
  getLocale,
  setLocale,
  t,
  type Locale,
} from "./i18n/index.js";
import { handleInfoSlashCommand } from "./infoScreen.js";
import {
  getCurrentSession,
  getSessionGoal,
  listSubagentSessions,
  setSessionGoal,
  updateSessionTitle,
} from "./session.js";
import { telemetryService } from "./telemetry/telemetryService.js";
import { loadAllPlugins } from "./plugins/loader.js";
import { buildImportSkillPrompt } from "./tools/skills.js";
import { readTodoState } from "./tools/todo.js";
import { SlashCommandResult } from "./ui/hooks/useChat.types.js";
import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "./util/loadMarkdownSkills.js";

type CommandHandler = (
  args: string[],
  assistant: AssistantConfig,
) => Promise<SlashCommandResult> | SlashCommandResult;

async function handleHelp(_args: string[], _assistant: AssistantConfig) {
  const helpMessage = [
    chalk.bold("Keyboard Shortcuts:"),
    "",
    chalk.white("Navigation:"),
    `  ${chalk.cyan("↑/↓")}        Navigate command/file suggestions or history`,
    `  ${chalk.cyan("Tab")}        Complete command or file selection`,
    `  ${chalk.cyan("Enter")}      Submit message`,
    `  ${chalk.cyan("Shift+Enter")} New line`,
    `  ${chalk.cyan("\\")}          Line continuation (at end of line)`,
    `  ${chalk.cyan("!")}          Shell mode - run shell commands`,
    "",
    chalk.white("Controls:"),
    `  ${chalk.cyan("Ctrl+C")}     Clear input`,
    `  ${chalk.cyan("Ctrl+D")}     Exit application`,
    `  ${chalk.cyan("Ctrl+L")}     Clear screen`,
    `  ${chalk.cyan("Shift+Tab")}  Cycle permission modes (agent/plan/auto)`,
    `  ${chalk.cyan("Esc")}        Cancel streaming or close suggestions`,
    "",
    chalk.white("Special Characters:"),
    `  ${chalk.cyan("@")}          Search and attach files for context`,
    `  ${chalk.cyan("/")}          Access slash commands`,
    `  ${chalk.cyan("!")}          Execute bash commands directly`,
    "",
    chalk.white("Available Commands:"),
    `  Type ${chalk.cyan("/")} to see available slash commands`,
    `  Type ${chalk.cyan("!")} followed by a command to execute bash directly`,
  ].join("\n");
  return { output: helpMessage };
}

async function handleFork() {
  try {
    const currentSession = getCurrentSession();
    const forkCommand = `tnt --fork ${currentSession.sessionId}`;
    // Try to copy to clipboard dynamically to avoid hard dependency in tests
    try {
      const clipboardy = await import("clipboardy");
      await clipboardy.default.write(forkCommand);
      return {
        exit: false,
        output: chalk.gray(`${forkCommand} (copied to clipboard)`),
      };
    } catch {
      return {
        exit: false,
        output: chalk.gray(`${forkCommand}`),
      };
    }
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to create fork command: ${error.message}`),
    };
  }
}

async function handleLanguage(args: string[]): Promise<SlashCommandResult> {
  const current = getLocale();

  if (args.length === 0) {
    const lines = LOCALES.map((locale) => {
      const marker = locale === current ? chalk.cyan("*") : " ";
      return `${marker} ${LOCALE_LABELS[locale]} (${locale})`;
    });
    return {
      output: [
        chalk.bold(t("language.title")),
        "",
        ...lines,
        "",
        chalk.dim(
          `Usage: /language ${LOCALES.map((locale) => locale).join("|")}`,
        ),
      ].join("\n"),
    };
  }

  const requested = args[0]?.trim().toLowerCase();
  const matched = LOCALES.find(
    (locale) =>
      locale.toLowerCase() === requested ||
      LOCALE_LABELS[locale].toLowerCase() === requested ||
      (locale.startsWith(requested) && requested.length >= 2),
  );

  if (!matched) {
    return {
      output: chalk.red(
        `Unknown language "${args[0]}". Choose one of: ${LOCALES.join(", ")}`,
      ),
    };
  }

  setLocale(matched as Locale);
  return {
    output: chalk.green(t("language.changed", { locale: matched })),
  };
}

function handleTitle(args: string[]) {
  const title = args.join(" ").trim();
  if (!title) {
    return {
      exit: false,
      output: chalk.yellow(
        "Please provide a title. Usage: /title <your title>",
      ),
    };
  }

  try {
    updateSessionTitle(title);
    return {
      exit: false,
      output: chalk.green(`Session title updated to: "${title}"`),
    };
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to update title: ${error.message}`),
    };
  }
}

function handleJobs() {
  return { openJobsSelector: true };
}

function handleGoal(args: string[]) {
  const goal = args.join(" ").trim();
  if (!goal) {
    const current = getSessionGoal();
    return {
      exit: false,
      output: current
        ? chalk.dim(`Current goal: ${current}`)
        : chalk.yellow(
            "No goal set. Usage: /goal <objective> or /goal clear to remove it.",
          ),
    };
  }

  if (goal.toLowerCase() === "clear" || goal.toLowerCase() === "none") {
    setSessionGoal(undefined);
    return {
      exit: false,
      output: chalk.dim("Goal cleared"),
    };
  }

  setSessionGoal(goal);
  return {
    exit: false,
    output: chalk.green(`Goal set: ${goal}`),
  };
}

function handlePlugins() {
  const result = loadAllPlugins();
  const installed = result.plugins;

  if (installed.length === 0) {
    return {
      exit: false,
      output: chalk.dim(
        "No plugins installed. Place plugins under ~/.tnt/plugins/cache/<marketplace>/<name>/<version>/.",
      ),
    };
  }

  const lines = installed.map((plugin) => {
    const note = plugin.id !== plugin.name ? ` (${plugin.id})` : "";
    const desc = plugin.description ? ` - ${plugin.description}` : "";
    return `  ${chalk.cyan(plugin.name)}${chalk.dim(note)}${desc}`;
  });

  return {
    exit: false,
    output: [
      chalk.bold(`Installed plugins (${installed.length})`),
      "",
      ...lines,
    ].join("\n"),
  };
}

async function handleSkills(): Promise<SlashCommandResult> {
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

async function handleImportSkill(args: string[]): Promise<SlashCommandResult> {
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

function handleSessions() {
  return { openSessionSelector: true };
}

function handleSubagents() {
  const parent = getCurrentSession();
  const children = listSubagentSessions(parent.sessionId);

  if (children.length === 0) {
    return {
      exit: false,
      output: chalk.dim(t("subagent.empty")),
    };
  }

  const lines = children.map((child) => {
    const label = child.subagentType ?? t("subagent.unlabeled");
    const preview = child.firstUserMessage
      ? ` - ${child.firstUserMessage.split("\n")[0]}`
      : "";
    return `  ${chalk.cyan(label)} ${chalk.dim(child.sessionId)}${preview}`;
  });

  return {
    exit: false,
    // The list is printed for headless runs; interactive runs also get a
    // picker so a delegated transcript can be opened directly.
    openSubagentsSelector: true,
    output: [
      chalk.bold(t("subagent.title", { count: children.length })),
      "",
      ...lines,
    ].join("\n"),
  };
}

function handleBackToParent() {
  const parentSessionId = getCurrentSession().parentSessionId;

  if (!parentSessionId) {
    return {
      exit: false,
      output: chalk.dim(t("subagent.noParent")),
    };
  }

  return { exit: false, loadSessionId: parentSessionId };
}

const EXPORTED_SESSION_VERSION = 1;

interface ExportedSession {
  version: number;
  exportedAt: string;
  session: Session;
}

function isValidExportedSession(data: unknown): data is ExportedSession {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    obj.version === EXPORTED_SESSION_VERSION &&
    typeof obj.exportedAt === "string" &&
    typeof obj.session === "object" &&
    obj.session !== null &&
    typeof (obj.session as Record<string, unknown>).sessionId === "string" &&
    typeof (obj.session as Record<string, unknown>).title === "string" &&
    Array.isArray((obj.session as Record<string, unknown>).history)
  );
}

function handleExport(_args: string[]): SlashCommandResult {
  return {
    exit: false,
    openExportSelector: true,
  };
}

function handleImport(args: string[]): SlashCommandResult {
  const filePath = args.join(" ").trim();
  if (!filePath) {
    return {
      exit: false,
      output: chalk.yellow(
        "Please provide a file path. Usage: /import <file-path>",
      ),
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      exit: false,
      output: chalk.red(`File not found: ${filePath}`),
    };
  }

  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const exportedData: unknown = JSON.parse(fileContent);

    if (!isValidExportedSession(exportedData)) {
      return {
        exit: false,
        output: chalk.red(
          "Invalid session file: expected a valid Continue exported session (version 1).",
        ),
      };
    }

    let session = exportedData.session;

    const existing = historyManager.load(session.sessionId);
    const sessionExists = existing.history.length > 0;

    if (sessionExists) {
      const originalId = session.sessionId;
      session = {
        ...session,
        sessionId: uuidv4(),
      };
      historyManager.save(session);
      return {
        exit: false,
        output: chalk.green(
          `Session imported with new ID: ${session.sessionId}\n` +
            chalk.gray(`(original ID: ${originalId} already existed)`),
        ),
      };
    }

    historyManager.save(session);
    return {
      exit: false,
      output: chalk.green(
        `Session imported: ${session.sessionId} (${session.title})`,
      ),
    };
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to import session: ${error.message}`),
    };
  }
}

function handleTodos(): SlashCommandResult {
  const { todos } = readTodoState();

  if (todos.length === 0) {
    return { output: chalk.dim("No todos yet.") };
  }

  const done = todos.filter((todo) => todo.done).length;
  const lines = todos.map((todo) => {
    const mark = todo.done ? chalk.green("✓") : chalk.dim("○");
    const id = chalk.cyan(`#${todo.id}`);
    const text = todo.done ? chalk.dim(todo.text) : todo.text;
    return `  ${mark} ${id} ${text}`;
  });

  return {
    output: [
      chalk.bold(`Todos (${done}/${todos.length} completed)`),
      "",
      ...lines,
    ].join("\n"),
  };
}

const commandHandlers: Record<string, CommandHandler> = {
  help: handleHelp,
  clear: () => {
    return { clear: true, output: "Chat history cleared" };
  },
  exit: () => {
    return { exit: true, output: "Goodbye!" };
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

export async function handleSlashCommands(
  input: string,
  assistant: AssistantConfig,
): Promise<SlashCommandResult | null> {
  // Only trigger slash commands if slash is the very first character
  if (!input.startsWith("/") || !input.trim().startsWith("/")) {
    return null;
  }

  const [command, ...args] = input.slice(1).split(" ");

  telemetryService.recordSlashCommand(command);

  const handler = commandHandlers[command];
  if (handler) {
    return await handler(args, assistant);
  }

  // Check for custom assistant prompts
  const assistantPrompt = assistant.prompts?.find(
    (prompt) => prompt?.name === command,
  );
  if (assistantPrompt) {
    const newInput = assistantPrompt.prompt + args.join(" ");
    return { newInput };
  }

  // Check for invokable rules
  const invokableRule = assistant.rules?.find((rule) => {
    // Handle both string rules and rule objects
    if (!rule || typeof rule === "string") {
      return false;
    }
    const ruleObj = rule as any;
    return ruleObj.invokable === true && ruleObj.name === command;
  });
  if (invokableRule) {
    const ruleObj = invokableRule as any;
    const newInput = ruleObj.rule + " " + args.join(" ");
    return { newInput };
  }

  const { skills } = await loadMarkdownSkills();
  if (skills.length) {
    const normalizedCommand = command.trim().toLowerCase();
    const matchingSkill = skills.find(
      (skill) => getSkillSlashCommandName(skill) === normalizedCommand,
    );

    if (matchingSkill) {
      return {
        newInput: `Load the skill using the **Skills** tool and then set the **skill_name** parameter to "${matchingSkill.name}".`,
      };
    }
  }

  // Check if this command would match any available commands (same logic as UI)
  const allCommands = await getAllSlashCommands(assistant);
  const hasMatches = allCommands.some((cmd) =>
    cmd.name.toLowerCase().includes(command.toLowerCase()),
  );

  // If no commands match, treat this as regular text instead of an unknown command
  if (!hasMatches) {
    return null;
  }

  return { output: `Unknown command: ${command}` };
}
