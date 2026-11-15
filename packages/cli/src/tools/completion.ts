import fs from "fs";
import path from "path";

import { COMPLETION_KINDS, getLspManager } from "../lsp/manager.js";

import { Tool } from "./types.js";

const DEFAULT_LIMIT = 20;

/**
 * Asks what could come next at a position. A coding agent uses this to see the
 * members of an object or the names in scope instead of inventing them, which
 * is the difference between guessing an API and reading it.
 */
export const completionTool: Tool = {
  name: "Completion",
  displayName: "Completion",
  description: `Ask the project's language servers what can be written at a position in a file.
Use it to see the members of an object or the names in scope before writing code that calls them.
Positions are counted from 1, as they appear in an editor.
Returns nothing when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["file_path", "line", "character"],
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file, absolute or relative to the project",
      },
      line: {
        type: "number",
        description: "Line number, counting from 1",
      },
      character: {
        type: "number",
        description: "Column number, counting from 1",
      },
      limit: {
        type: "number",
        description: `How many candidates to return, at most (default ${DEFAULT_LIMIT})`,
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    file_path,
    line,
    character,
    limit,
  }: {
    file_path: string;
    line: number;
    character: number;
    limit?: number;
  }): Promise<string> => {
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "Completion needs a file_path argument.";
    }
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 1 ||
      character < 1
    ) {
      return "Completion needs a line and a character, both counting from 1.";
    }
    const absolute = path.resolve(file_path);
    if (!fs.existsSync(absolute)) {
      return `No such file: ${file_path}`;
    }

    const manager = getLspManager();
    const running = await manager.ensureStarted(process.cwd());
    if (running === 0) {
      return "No language server is configured. A plugin can declare one under lspServers in its manifest.";
    }

    const items = await manager.completionAt(absolute, line, character);
    if (items.length === 0) {
      return `No completions at ${file_path}:${line}:${character}.`;
    }

    const cap =
      Number.isInteger(limit) && (limit as number) > 0
        ? (limit as number)
        : DEFAULT_LIMIT;
    const shown = items.slice(0, cap);
    const lines = shown.map((item) => {
      const kind = COMPLETION_KINDS[item.kind ?? 0] ?? "candidate";
      const detail = item.detail ? ` - ${item.detail}` : "";
      return `${item.label} (${kind})${detail}`;
    });
    const more =
      items.length > shown.length
        ? `\n(${items.length - shown.length} more not shown)`
        : "";
    return `${items.length} candidate(s) at ${file_path}:${line}:${character}:\n${lines.join("\n")}${more}`;
  },
};
