import type { AssistantConfig } from "@tnt/sdk";

import { telemetryService } from "../telemetry/telemetryService.js";
import {
  getSkillSlashCommandName,
  loadMarkdownSkills,
} from "../util/loadMarkdownSkills.js";

import { createCommandHandlers } from "./handlers/index.js";
import {
  buildPluginCommandInput,
  findPluginCommand,
} from "./loaders/pluginCommands.js";
import { getAllSlashCommands } from "./service.js";
import type { SlashCommandResult } from "./types.js";

const commandHandlers = createCommandHandlers();

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

  // Plugin commands are prompt-based, so they are forwarded as new input.
  const pluginCommand = findPluginCommand(command);
  if (pluginCommand) {
    return { newInput: buildPluginCommandInput(pluginCommand, args) };
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
