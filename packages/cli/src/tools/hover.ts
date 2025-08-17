import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { Tool } from "./types.js";

/**
 * Reads what a language server says about a position: a type signature, a doc
 * comment, or both. Paired with FindSymbol it closes the loop a coding agent
 * needs, from "where is this declared" to "what does it take".
 */
export const hoverTool: Tool = {
  name: "Hover",
  displayName: "Hover",
  description: `Read the type signature or documentation a language server reports for a position in a file.
Use it after FindSymbol to see what a symbol expects. Positions are counted from 1, as they appear in an editor.
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
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    file_path,
    line,
    character,
  }: {
    file_path: string;
    line: number;
    character: number;
  }): Promise<string> => {
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "Hover needs a file_path argument.";
    }
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 1 ||
      character < 1
    ) {
      return "Hover needs a line and a character, both counting from 1.";
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

    const description = await manager.hoverAt(absolute, line, character);
    if (!description) {
      return `Nothing to show at ${file_path}:${line}:${character}.`;
    }
    return `${file_path}:${line}:${character}\n${description}`;
  },
};
