import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { describeLspUri } from "./lspLocations.js";
import { Tool } from "./types.js";

const MAX_LOCATIONS = 50;

type DefinitionKind = "definition" | "implementation";

/**
 * Where the symbol at a position is declared, or which implementations the
 * language server knows. FindSymbol answers "where is this name declared"
 * without a position; this answers the same question for the exact position
 * the model is looking at, including interface implementations.
 */
export const definitionTool: Tool = {
  name: "Definition",
  displayName: "Definition",
  description: `Ask the project's language servers where the symbol at a position is defined, or which implementations exist.
Use it after reading a call site when FindSymbol's name search is too broad. Positions are counted from 1, as they appear in an editor.
Returns nothing when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["file_path", "line", "character", "kind"],
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
      kind: {
        type: "string",
        enum: ["definition", "implementation"],
        description:
          '"definition" for the declaration, "implementation" for implementations',
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    file_path,
    line,
    character,
    kind,
  }: {
    file_path: string;
    line: number;
    character: number;
    kind: DefinitionKind;
  }): Promise<string> => {
    if (kind !== "definition" && kind !== "implementation") {
      return 'Definition kind must be "definition" or "implementation".';
    }
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "Definition needs a file_path argument.";
    }
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 1 ||
      character < 1
    ) {
      return "Definition needs a line and a character, both counting from 1.";
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

    const locations = await manager.definitionAt(
      absolute,
      line,
      character,
      kind,
    );
    if (locations.length === 0) {
      return `No ${kind} found at ${file_path}:${line}:${character}. The language server may not index this project yet.`;
    }

    const shown = locations.slice(0, MAX_LOCATIONS);
    const lines = shown.map((location) => {
      const start = location.range?.start;
      if (typeof start?.line !== "number") {
        return describeLspUri(location.uri);
      }
      return `${describeLspUri(location.uri)}:${start.line + 1}:${(start.character ?? 0) + 1}`;
    });
    const cut =
      locations.length > shown.length
        ? `\n[showing ${shown.length} of ${locations.length}]`
        : "";
    return `${locations.length} ${kind}(s) for ${file_path}:${line}:${character}:\n${lines.join("\n")}${cut}`;
  },
};
