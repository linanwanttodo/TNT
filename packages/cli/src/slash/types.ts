import type { AssistantConfig } from "@tnt/sdk";

export interface SlashCommand {
  name: string;
  description: string;
  category: "system" | "assistant";
}

export interface SystemCommand extends SlashCommand {
  category: "system";
}

export interface SlashCommandResult {
  output?: string;
  exit?: boolean;
  newInput?: string;
  clear?: boolean;
  openConfigSelector?: boolean;
  openModelSelector?: boolean;
  openMcpSelector?: boolean;
  openUpdateSelector?: boolean;
  openSessionSelector?: boolean;
  openSubagentsSelector?: boolean;
  /** Load this session instead of the current one, e.g. returning to a parent. */
  loadSessionId?: string;
  openJobsSelector?: boolean;
  openExportSelector?: boolean;
  compact?: boolean;
  diffContent?: string;
}

export type CommandHandler = (
  args: string[],
  assistant: AssistantConfig,
) => Promise<SlashCommandResult> | SlashCommandResult;

/**
 * Where a slash command came from. The order of this union is also the
 * resolution priority used by the resolver: a name claimed by an earlier
 * source is never taken over by a later one.
 */
export type CommandSource =
  | "builtin"
  | "remote"
  | "prompt"
  | "rule"
  | "skill"
  | "plugin";

export interface CommandLoadContext {
  assistant: AssistantConfig;
  isRemoteMode: boolean;
}

export interface CommandLoader {
  readonly source: CommandSource;
  loadCommands(context: CommandLoadContext): Promise<SlashCommand[]>;
}

export interface LoadedCommandSet {
  source: CommandSource;
  commands: SlashCommand[];
}

export interface CommandConflict {
  name: string;
  winner: CommandSource;
  losers: Array<{ source: CommandSource; command: SlashCommand }>;
}
