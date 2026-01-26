import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { symbolKindName } from "./lspSymbolKinds.js";
import { Tool } from "./types.js";

/**
 * The outline of one file: what it declares and where. It is the cheap first
 * step before reading a large file, and the structure behind FindSymbol when
 * the name is already known but the shape is not.
 */
export const documentSymbolTool: Tool = {
  name: "DocumentSymbol",
  displayName: "Document Outline",
  description: `List the symbols a file declares, as an outline with nesting and positions.
Use it to understand a file's shape before reading it, or to find the line to pass to Hover, References or CallHierarchy. Positions are counted from 1, as they appear in an editor.
Returns nothing when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["file_path"],
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file, absolute or relative to the project",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({ file_path }: { file_path: string }): Promise<string> => {
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "DocumentSymbol needs a file_path argument.";
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

    const symbols = await manager.documentSymbols(absolute);
    if (symbols.length === 0) {
      return `No symbols found in ${file_path}. The language server may not support this file, or may still be indexing.`;
    }

    const lines = symbols.map((symbol) => {
      const where =
        typeof symbol.line === "number"
          ? ` ${symbol.line}:${symbol.character ?? 1}`
          : "";
      return `${"  ".repeat(symbol.depth)}${symbolKindName(symbol.kind)} ${symbol.name}${where}`;
    });
    return `${symbols.length} symbol(s) in ${file_path}:\n${lines.join("\n")}`;
  },
};
