import { BUILT_IN_AGENTS } from "../subagent/builtInAgents.js";

/**
 * One row of the composer's suggestion overlay. The same list carries commands
 * for a `/` token and files, agents and MCP resources for an `@` token, so the
 * reader sees one list and one set of keys instead of two panels that may both
 * claim the arrow keys.
 */
export type SuggestionKind = "command" | "file" | "agent" | "mcp";

export interface SuggestionItem {
  kind: SuggestionKind;
  /** Stable identity across source refreshes. */
  key: string;
  /** Text after the type icon. Commands already carry their `/`. */
  label: string;
  /** Secondary row text; also searched. */
  description: string;
  /** The value placed in the composer after the trigger character. */
  insertText: string;
  /** Files only: the path to read and attach on accept. */
  filePath?: string;
  /** Files only: a directory completes with no trailing space. */
  isDirectory?: boolean;
}

/** Claude Code's type marks: command rows carry none. */
export const SUGGESTION_ICONS: Readonly<Record<SuggestionKind, string>> = {
  command: "",
  file: "+",
  agent: "*",
  mcp: "◇",
};

/** Five rows at a time, with the window moving around the selection. */
export const MAX_VISIBLE_SUGGESTIONS = 5;

/** How many matches a source may contribute before the window slices them. */
export const SUGGESTION_RESULT_LIMIT = 15;

export function suggestionIcon(kind: SuggestionKind): string {
  return SUGGESTION_ICONS[kind];
}

/** The row text as drawn: icon, space, label, commands bare. */
export function suggestionDisplay(item: SuggestionItem): string {
  const icon = suggestionIcon(item.kind);
  return icon ? `${icon} ${item.label}` : item.label;
}

export interface CommandSuggestionSource {
  name: string;
  description: string;
}

export function commandSuggestionItems(
  commands: readonly CommandSuggestionSource[],
): SuggestionItem[] {
  return commands.map((command) => ({
    kind: "command",
    key: `command:${command.name}`,
    label: `/${command.name}`,
    description: command.description,
    insertText: `/${command.name}`,
  }));
}

export interface FileSuggestionSource {
  path: string;
  displayName?: string;
}

/** A file row; `description` is the containing directory, when there is one. */
export function fileSuggestionFromPath(filePath: string): SuggestionItem {
  const separator = filePath.lastIndexOf("/");
  return {
    kind: "file",
    key: `file:${filePath}`,
    label: filePath,
    description: separator === -1 ? "" : filePath.slice(0, separator),
    insertText: filePath,
    filePath,
  };
}

/**
 * Split a path list into its first segments. `@` on its own asks where to
 * start, not for a fuzzy match over the whole index, so it shows the top-level
 * directories and files the reader can descend into.
 */
export function topLevelPathItems(
  files: readonly FileSuggestionSource[],
): SuggestionItem[] {
  const directories = new Map<string, SuggestionItem>();
  const plainFiles = new Map<string, SuggestionItem>();

  for (const file of files) {
    const segments = file.path.split("/");
    if (segments.length > 1) {
      const directory = segments[0];
      if (!directories.has(directory)) {
        directories.set(directory, {
          kind: "file",
          key: `file:${directory}/`,
          label: `${directory}/`,
          description: "",
          insertText: `${directory}/`,
          isDirectory: true,
        });
      }
    } else if (file.path !== "") {
      plainFiles.set(file.path, fileSuggestionFromPath(file.path));
    }
  }

  const byLabel = (a: SuggestionItem, b: SuggestionItem) =>
    a.label.localeCompare(b.label);
  return [
    ...[...directories.values()].sort(byLabel),
    ...[...plainFiles.values()].sort(byLabel),
  ].slice(0, SUGGESTION_RESULT_LIMIT);
}

/** Case-insensitive over the label and the description. */
export function filterSuggestionItems(
  items: readonly SuggestionItem[],
  query: string,
): SuggestionItem[] {
  const needle = query.toLowerCase();
  if (needle === "") {
    return [...items];
  }
  return items.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(needle),
  );
}

/**
 * File rows for an `@` token. An empty query is the top-level view; anything
 * else is a case-insensitive substring match over the path.
 */
export function fileSuggestionItems(
  files: readonly FileSuggestionSource[],
  query: string,
): SuggestionItem[] {
  if (query === "") {
    return topLevelPathItems(files);
  }
  return filterSuggestionItems(
    files.map((file) => fileSuggestionFromPath(file.path)),
    query,
  ).slice(0, SUGGESTION_RESULT_LIMIT);
}

export interface AgentSuggestionSource {
  name: string;
  description?: string;
}

/** Configured subagent models plus the built-in roles they do not shadow. */
export function agentSourcesFromModelState(
  state:
    | {
        model?: unknown;
        assistant?: {
          models?: ReadonlyArray<{
            name?: string;
            description?: string;
            roles?: readonly string[];
            chatOptions?: { baseSystemMessage?: string };
          } | null>;
        } | null;
      }
    | null
    | undefined,
): AgentSuggestionSource[] {
  const models = state?.assistant?.models ?? [];
  const configured = models.filter(
    (model): model is NonNullable<typeof model> =>
      Boolean(
        model &&
        model.name &&
        model.roles?.includes("subagent") &&
        model.chatOptions?.baseSystemMessage,
      ),
  );
  const sources: AgentSuggestionSource[] = configured.map((model) => ({
    name: model.name as string,
    description: model.description,
  }));
  const named = new Set(sources.map((source) => source.name));

  // A built-in runs on the session model, so it is only dispatchable when
  // there is a model to inherit.
  if (state?.model || configured.length > 0) {
    for (const agent of BUILT_IN_AGENTS) {
      if (!named.has(agent.name)) {
        sources.push({ name: agent.name, description: agent.description });
      }
    }
  }
  return sources;
}

export function agentSuggestionItems(
  agents: readonly AgentSuggestionSource[],
): SuggestionItem[] {
  return agents.map((agent) => ({
    kind: "agent",
    key: `agent:${agent.name}`,
    label: agent.name,
    description: agent.description ?? "",
    insertText: agent.name,
  }));
}

export interface McpResourceSuggestionSource {
  uri?: string;
  name?: string;
  title?: string;
  description?: string;
}

export function mcpSuggestionItems(
  resources: readonly McpResourceSuggestionSource[],
): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const resource of resources) {
    const label = resource.name ?? resource.title ?? resource.uri;
    if (!label) {
      continue;
    }
    const insertText = resource.uri ?? label;
    items.push({
      kind: "mcp",
      key: `mcp:${insertText}`,
      label,
      description: resource.description ?? resource.uri ?? "",
      insertText,
    });
  }
  return items;
}

/**
 * The MCP service state carries tools and prompts today; resources are read
 * defensively so a connection that starts listing them needs no UI change.
 */
export function mcpResourcesFromState(
  state: unknown,
): McpResourceSuggestionSource[] {
  if (!state || typeof state !== "object") {
    return [];
  }
  const resources = (state as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) {
    return [];
  }
  return resources.filter(
    (resource): resource is McpResourceSuggestionSource =>
      Boolean(resource) && typeof resource === "object",
  );
}

/**
 * One list, in Claude Code's group order: files, then agents, then MCP
 * resources. Duplicate identities keep the first row.
 */
export function mergeSuggestionGroups(
  ...groups: ReadonlyArray<readonly SuggestionItem[]>
): SuggestionItem[] {
  const seen = new Set<string>();
  const merged: SuggestionItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      merged.push(item);
    }
  }
  return merged;
}

/** The rows the five-row window draws, keeping the selection visible. */
export function visibleSuggestionWindow(
  items: readonly SuggestionItem[],
  selectedIndex: number,
  size: number = MAX_VISIBLE_SUGGESTIONS,
): SuggestionItem[] {
  if (items.length <= size) {
    return [...items];
  }
  const start = windowStart(items.length, selectedIndex, size);
  return items.slice(start, start + size);
}

export function windowStart(
  total: number,
  selectedIndex: number,
  size: number = MAX_VISIBLE_SUGGESTIONS,
): number {
  return Math.max(0, Math.min(selectedIndex - (size - 1), total - size));
}
