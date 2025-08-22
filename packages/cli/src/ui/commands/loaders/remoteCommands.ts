import { REMOTE_MODE_SLASH_COMMANDS, toSystemCommand } from "../builtins.js";
import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

export class RemoteCommandLoader implements CommandLoader {
  readonly source = "remote" as const;

  async loadCommands(_context: CommandLoadContext): Promise<SlashCommand[]> {
    return REMOTE_MODE_SLASH_COMMANDS.map(toSystemCommand);
  }
}
