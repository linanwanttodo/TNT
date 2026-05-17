const EDITED_ARGUMENT: Record<string, string> = {
  Write: "filepath",
  Edit: "file_path",
  MultiEdit: "file_path",
};

/** The paths one finished tool call touched, or an empty list. */
export function changedPaths(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  if (toolName === "ApplyPatch") {
    if (typeof record.patch !== "string") return [];
    return [...record.patch.matchAll(/^\*\*\* Update File: (.+)$/gm)].map(
      (match) => match[1]!.trim(),
    );
  }
  const key = EDITED_ARGUMENT[toolName];
  const value = key ? record[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? [value] : [];
}

/** Aggregate the paths a turn touched, deduplicated and sorted. */
export function summarizeChangedFiles(paths: string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

/** A short argument hint for a tool row, or undefined for opaque calls. */
export function toolArguments(
  toolName: string,
  args: unknown,
): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const keys: Record<string, string> = {
    ...EDITED_ARGUMENT,
    Bash: "command",
    Read: "file_path",
    Glob: "pattern",
    Grep: "pattern",
    WebFetch: "url",
    WebSearch: "query",
  };
  const key = keys[toolName];
  const value = key ? record[key] : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}
