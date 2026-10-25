import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { describeLspUri } from "./lspLocations.js";
import { Tool } from "./types.js";

const MAX_REFERENCES = 50;

/**
 * Every use of a symbol, which is the question a text search cannot answer:
 * the same name in another scope is not a reference, and an alias is.
 */
export const referencesTool: Tool = {
  name: "References",
  displayName: "References",
  description: `Ask the project's language servers for every reference to the symbol at a position.
Use this to find call sites, imports and other uses after FindSymbol gives you the declaration. Positions are counted from 1, as they appear in an editor.
Returns nothing when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["file_path", "line", "character"],
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file, absolute or relative to the project",
      },
      line: { type: "number", description: "Line number, counting from 1" },
      character: {
        type: "number",
        description: "Column number, counting from 1",
      },
      include_declaration: {
        type: "boolean",
        description: "Whether the declaration itself is included; default true",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    file_path,
    line,
    character,
    include_declaration,
  }: {
    file_path: string;
    line: number;
    character: number;
    include_declaration?: boolean;
  }): Promise<string> => {
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "References needs a file_path argument.";
    }
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 1 ||
      character < 1
    ) {
      return "References needs a line and a character, both counting from 1.";
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

    const locations = await manager.referencesAt(
      absolute,
      line,
      character,
      include_declaration !== false,
    );
    if (locations.length === 0) {
      return `No references found at ${file_path}:${line}:${character}. The language server may not index this project yet, or the symbol has no uses.`;
    }

    const shown = locations.slice(0, MAX_REFERENCES);
    const lines = shown.map((location) => {
      const start = location.range?.start;
      if (typeof start?.line !== "number") {
        return describeLspUri(location.uri);
      }
      return `${describeLspUri(location.uri)}:${start.line + 1}:${(start.character ?? 0) + 1}`;
    });
    const cut =
      locations.length > shown.length
        ? `\n[showing ${shown.length} of ${locations.length}; move the position closer to the declaration for the rest]`
        : "";
    return `${locations.length} reference(s) to the symbol at ${file_path}:${line}:${character}:\n${lines.join("\n")}${cut}`;
  },
};
