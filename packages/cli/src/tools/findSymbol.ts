import path from "path";
import { fileURLToPath } from "url";

import { getLspManager } from "../lsp/manager.js";

import { symbolKindName } from "./lspSymbolKinds.js";
import { Tool } from "./types.js";

function describeLocation(uri: string | undefined): string {
  if (!uri) return "?";
  if (!uri.startsWith("file://")) return uri;
  try {
    return path.relative(process.cwd(), fileURLToPath(uri)) || ".";
  } catch {
    return uri;
  }
}

/**
 * Asks the project's language servers where a name is defined. This answers with
 * the declaration rather than every mention, which is the question a text search
 * cannot answer on its own.
 */
export const findSymbolTool: Tool = {
  name: "FindSymbol",
  displayName: "Find Symbol",
  description: `Ask the project's language servers where a symbol is defined.
Prefer this over searching text when you need the declaration of a function, class or variable and not every use of its name.
Returns nothing when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "Symbol name or prefix to look up",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({ query }: { query: string }): Promise<string> => {
    if (typeof query !== "string" || !query.trim()) {
      return "FindSymbol needs a query argument.";
    }
    const manager = getLspManager();
    const running = await manager.ensureStarted(process.cwd());
    if (running === 0) {
      return "No language server is configured. A plugin can declare one under lspServers in its manifest.";
    }

    const symbols = await manager.findSymbols(query);
    if (symbols.length === 0) {
      return `No symbol matched "${query}".`;
    }

    const lines = symbols.map((symbol) => {
      const start = symbol.location?.range?.start;
      const where =
        typeof start?.line === "number"
          ? `${describeLocation(symbol.location?.uri)}:${start.line + 1}:${(start.character ?? 0) + 1}`
          : describeLocation(symbol.location?.uri);
      const kind = symbolKindName(symbol.kind);
      const container = symbol.containerName
        ? ` in ${symbol.containerName}`
        : "";
      return `${where} ${kind} ${symbol.name}${container}`;
    });
    return `${symbols.length} symbol(s) for "${query}":\n${lines.join("\n")}`;
  },
};
