import { loadLocalCommandFiles } from "../../../commands/localCommandFiles.js";
import type { CommandLoader, SlashCommand } from "../types.js";

export {
  buildLocalCommandInput,
  findLocalCommand,
  loadLocalCommandFiles,
  localCommandRoots,
  type LocalCommandFile,
} from "../../../commands/localCommandFiles.js";

export class LocalCommandLoader implements CommandLoader {
  readonly source = "local" as const;

  async loadCommands(): Promise<SlashCommand[]> {
    return loadLocalCommandFiles()
      .filter((command) => command.enabled)
      .map((command) => ({
        name: command.name,
        description: command.description,
        category: "assistant" as const,
      }));
  }
}
