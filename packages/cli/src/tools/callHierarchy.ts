import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { describeLspUri } from "./lspLocations.js";
import { Tool } from "./types.js";

const MAX_CALLS = 50;

type Direction = "incoming" | "outgoing";

/**
 * The callers of a symbol, or what it calls. This is the edge a symbol lookup
 * and a text search both miss: it is the server's graph, not a name match.
 */
export const callHierarchyTool: Tool = {
  name: "CallHierarchy",
  displayName: "Call Hierarchy",
  description: `Ask the project's language servers which functions call a symbol, or which functions it calls.
Use it after FindSymbol to walk the call graph in either direction. Positions are counted from 1, as they appear in an editor.
Returns nothing when the project has no language server configured or the server has no call-hierarchy support.`,
  parameters: {
    type: "object",
    required: ["file_path", "line", "character", "direction"],
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
      direction: {
        type: "string",
        enum: ["incoming", "outgoing"],
        description:
          "incoming for callers of the symbol, outgoing for what it calls",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    file_path,
    line,
    character,
    direction,
  }: {
    file_path: string;
    line: number;
    character: number;
    direction: Direction;
  }): Promise<string> => {
    if (direction !== "incoming" && direction !== "outgoing") {
      return 'CallHierarchy direction must be "incoming" or "outgoing".';
    }
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "CallHierarchy needs a file_path argument.";
    }
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 1 ||
      character < 1
    ) {
      return "CallHierarchy needs a line and a character, both counting from 1.";
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

    const hierarchy = await manager.callHierarchyAt(
      absolute,
      line,
      character,
      direction,
    );
    if (!hierarchy) {
      return `The language server could not build a call hierarchy at ${file_path}:${line}:${character}. It may not support call hierarchies, or may not have indexed this file yet.`;
    }
    if (hierarchy.sites.length === 0) {
      return `${hierarchy.symbol} (${direction}) has no ${direction === "incoming" ? "callers" : "calls"}.`;
    }

    const shown = hierarchy.sites.slice(0, MAX_CALLS);
    const lines = shown.map((site) => {
      const where =
        typeof site.line === "number"
          ? `${describeLspUri(site.uri)}:${site.line}:${site.character ?? 1}`
          : describeLspUri(site.uri);
      return `${where} ${site.name}`;
    });
    const cut =
      hierarchy.sites.length > shown.length
        ? `\n[showing ${shown.length} of ${hierarchy.sites.length}]`
        : "";
    return `${hierarchy.symbol} (${direction}):\n${lines.join("\n")}${cut}`;
  },
};
