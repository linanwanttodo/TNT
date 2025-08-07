import { loadAllPlugins, type PluginCommands } from "../../plugins/loader.js";
import { logger } from "../../util/logger.js";
import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

/** Commands contributed by installed plugins, namespaced as plugin:command. */
export class PluginCommandLoader implements CommandLoader {
  readonly source = "plugin" as const;

  async loadCommands(_context: CommandLoadContext): Promise<SlashCommand[]> {
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
}

/**
 * Plugin commands are markdown prompts, so the dispatcher forwards them as new
 * input instead of running them in-process.
 */
export function findPluginCommand(name: string): PluginCommands | undefined {
  try {
    const key = name.trim().toLowerCase();

    return loadAllPlugins().commands.find(
      (command) => command.name.toLowerCase() === key,
    );
  } catch (error) {
    logger.warn("Failed to load plugin commands:", error);
    return undefined;
  }
}

export function buildPluginCommandInput(
  command: PluginCommands,
  args: string[],
): string {
  const argument = args.join(" ").trim();
  const body = (command.content ?? "").trim();

  if (!body) {
    return argument;
  }

  return argument ? `${body}\n\n${argument}` : body;
}
