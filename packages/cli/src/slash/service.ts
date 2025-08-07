import type { AssistantConfig } from "@tnt/sdk";

import { logger } from "../util/logger.js";

import {
  AssistantPromptLoader,
  InvokableRuleLoader,
} from "./loaders/assistantCommands.js";
import { BuiltinCommandLoader } from "./loaders/builtinCommands.js";
import { PluginCommandLoader } from "./loaders/pluginCommands.js";
import { RemoteCommandLoader } from "./loaders/remoteCommands.js";
import { SkillCommandLoader } from "./loaders/skillCommands.js";
import { resolveCommands } from "./resolver.js";
import type {
  CommandConflict,
  CommandLoadContext,
  CommandLoader,
  LoadedCommandSet,
  SlashCommand,
} from "./types.js";

export interface CommandServiceOptions {
  isRemoteMode?: boolean;
}

/**
 * Command sources are pluggable: every source implements `CommandLoader`, and
 * the service only has to load them and reconcile the names they return.
 */
function createLoaders(isRemoteMode: boolean): CommandLoader[] {
  if (isRemoteMode) {
    return [new RemoteCommandLoader()];
  }

  return [
    new BuiltinCommandLoader(),
    new AssistantPromptLoader(),
    new InvokableRuleLoader(),
    new SkillCommandLoader(),
    new PluginCommandLoader(),
  ];
}

export class CommandService {
  private constructor(
    private readonly commands: readonly SlashCommand[],
    private readonly conflicts: readonly CommandConflict[],
  ) {}

  static async create(
    assistant: AssistantConfig,
    options: CommandServiceOptions = {},
  ): Promise<CommandService> {
    const isRemoteMode = options.isRemoteMode ?? false;
    const context: CommandLoadContext = { assistant, isRemoteMode };
    const sets = await CommandService.loadAll(
      createLoaders(isRemoteMode),
      context,
    );
    const { commands, conflicts } = resolveCommands(sets);

    for (const conflict of conflicts) {
      logger.debug("Slash command name conflict", {
        name: conflict.name,
        winner: conflict.winner,
        losers: conflict.losers.map((loser) => loser.source),
      });
    }

    return new CommandService(
      Object.freeze(commands),
      Object.freeze(conflicts),
    );
  }

  /** Sources are independent, so a failing one only drops its own commands. */
  private static async loadAll(
    loaders: CommandLoader[],
    context: CommandLoadContext,
  ): Promise<LoadedCommandSet[]> {
    const results = await Promise.allSettled(
      loaders.map((loader) => loader.loadCommands(context)),
    );

    return results.map((result, index) => {
      const source = loaders[index].source;

      if (result.status === "rejected") {
        logger.warn(`Failed to load ${source} slash commands:`, result.reason);
        return { source, commands: [] };
      }

      return { source, commands: result.value };
    });
  }

  getCommands(): readonly SlashCommand[] {
    return this.commands;
  }

  getConflicts(): readonly CommandConflict[] {
    return this.conflicts;
  }

  find(name: string): SlashCommand | undefined {
    const key = name.trim().toLowerCase();
    return this.commands.find((command) => command.name.toLowerCase() === key);
  }

  /** Case-insensitive substring match, mirroring the suggestion list. */
  matches(query: string): SlashCommand[] {
    const key = query.trim().toLowerCase();
    return this.commands.filter((command) =>
      command.name.toLowerCase().includes(key),
    );
  }
}

/** Get all available slash commands including system commands and assistant prompts */
export async function getAllSlashCommands(
  assistant: AssistantConfig,
  options: CommandServiceOptions = {},
): Promise<SlashCommand[]> {
  const service = await CommandService.create(assistant, options);

  return [...service.getCommands()];
}
