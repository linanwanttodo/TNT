import type { SlashCommand } from "./commands/types.js";

/**
 * The slash tree at the caret, parsed the way gemini-cli's useSlashCompletion
 * does: completed path parts walk the command tree, the last token is the
 * partial being completed, and a leaf with free-form arguments stops the
 * palette. Unlike the old two-token special case this handles any depth.
 */
export interface SlashParse {
  /** Whether the palette should be visible. */
  active: boolean;
  /** The commands offered at this level. */
  level: SlashCommand[];
  /** The partial token being completed. */
  filter: string;
  /** Completed parent path, used for the level label and for running leaves. */
  path: string[];
  /** A completed leaf command, when the caret is inside its arguments. */
  leaf: SlashCommand | null;
  /** True when the text ends with a separator and the next part is a child. */
  trailingSpace: boolean;
}

function asCommands(subcommands: SlashCommand["subcommands"]): SlashCommand[] {
  return (subcommands ?? []).map((child) => ({
    name: child.name,
    description: child.description,
    category: "system" as const,
  }));
}

function matchesCommand(command: SlashCommand, token: string): boolean {
  return command.name.toLowerCase() === token.toLowerCase();
}

export function parseSlashInput(
  text: string,
  cursor: number,
  commands: SlashCommand[],
): SlashParse {
  const inactive: SlashParse = {
    active: false,
    level: [],
    filter: "",
    path: [],
    leaf: null,
    trailingSpace: false,
  };

  const beforeCursor = text.slice(0, cursor).trimStart();
  if (!beforeCursor.startsWith("/")) {
    return inactive;
  }

  const body = beforeCursor.slice(1);
  const trailingSpace = /\s$/.test(body);
  const parts = body.split(/\s+/).filter(Boolean);
  const partial = trailingSpace ? "" : (parts.pop() ?? "");
  const completedParts = parts;

  let level = commands;
  let leaf: SlashCommand | null = null;

  for (const part of completedParts) {
    const found = level.find((command) => matchesCommand(command, part));
    if (!found) {
      // A leaf's free-form arguments: no palette.
      return inactive;
    }
    leaf = found;
    level = asCommands(found.subcommands);
    if (level.length === 0) {
      // The command takes free-form arguments; the palette belongs to the
      // command itself, not to the text that follows it.
      return inactive;
    }
  }

  // An exact, argument-less leaf keeps its own row visible for completion;
  // with a trailing space the reader has moved into its children instead.
  const exact = level.find((command) => matchesCommand(command, partial));
  if (exact && !trailingSpace && level === commands && partial.length > 0) {
    return {
      active: true,
      level,
      filter: partial,
      path: completedParts,
      leaf: null,
      trailingSpace,
    };
  }

  return {
    active: true,
    level,
    filter: partial,
    path: completedParts,
    leaf: trailingSpace ? leaf : null,
    trailingSpace,
  };
}

/** Commands whose name or description contains the partial, prefixes first. */
export function filterSlashLevel(
  commands: readonly SlashCommand[],
  filter: string,
): SlashCommand[] {
  const needle = filter.toLowerCase();
  return commands
    .filter(
      (command) =>
        command.name.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(needle);
      const bStartsWith = b.name.toLowerCase().startsWith(needle);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      return a.name.localeCompare(b.name);
    });
}
