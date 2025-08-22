import { BUILTIN_SLASH_COMMANDS, toSystemCommand } from "../builtins.js";
import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

export class BuiltinCommandLoader implements CommandLoader {
  readonly source = "builtin" as const;

  async loadCommands(_context: CommandLoadContext): Promise<SlashCommand[]> {
    return BUILTIN_SLASH_COMMANDS.map(toSystemCommand);
  }
}
