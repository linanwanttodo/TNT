import type {
  CommandConflict,
  LoadedCommandSet,
  SlashCommand,
  CommandSource,
} from "./types.js";

export interface ResolvedCommandSet {
  commands: SlashCommand[];
  conflicts: CommandConflict[];
}

/**
 * Flattens the loaded command sets into one list without duplicate names.
 * The first source that claims a name keeps it; later claims with the same
 * name are reported as conflicts instead of shadowing it silently.
 */
export function resolveCommands(sets: LoadedCommandSet[]): ResolvedCommandSet {
  const commands: SlashCommand[] = [];
  const owners = new Map<string, CommandSource>();
  const conflicts = new Map<string, CommandConflict>();

  for (const set of sets) {
    for (const command of set.commands) {
      const key = command.name.toLowerCase();
      const owner = owners.get(key);

      if (owner === undefined) {
        owners.set(key, set.source);
        commands.push(command);
        continue;
      }

      const conflict = conflicts.get(key) ?? {
        name: command.name,
        winner: owner,
        losers: [],
      };
      conflict.losers.push({ source: set.source, command });
      conflicts.set(key, conflict);
    }
  }

  return { commands, conflicts: [...conflicts.values()] };
}
