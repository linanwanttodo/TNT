import { getLspManager } from "../lsp/manager.js";
import {
  lookupLocalSymbols,
  type SymbolIndexHit,
} from "../retrieval/symbolIndex.js";
import { workspaceRoot as currentWorkspaceRoot } from "../utils/workspaceScope.js";

import { describeLspUri } from "./lspLocations.js";
import { symbolKindName } from "./lspSymbolKinds.js";
import { Tool } from "./types.js";

/**
 * Asks the project's language servers where a name is defined. This answers with
 * the declaration rather than every mention, which is the question a text search
 * cannot answer on its own.
 */

/**
 * The knowledge-layer answer: what the local declaration index knows, with
 * the provenance a model needs to trust it and the instruction that keeps a
 * heuristic hit from being edited blind.
 */
function localLayerAnswer(
  query: string,
  hits: SymbolIndexHit[],
  contextSentence: string,
): string {
  const rows = hits.map(
    (hit) => `${hit.path}:${hit.line} ${hit.kind} ${hit.name}`,
  );
  return [
    `${hits.length} declaration(s) for "${query}" from the local tree-sitter declaration index. ${contextSentence}`,
    ...rows,
    "Lines are 1-based and the index is heuristic; Read the file to confirm before editing.",
  ].join("\n");
}

export const findSymbolTool: Tool = {
  name: "FindSymbol",
  displayName: "Find Symbol",
  description: `Ask the project's language servers where a symbol is defined.
Prefer this over searching text when you need the declaration of a function, class or variable and not every use of its name.
When no language server is configured - or one has no match - the answer comes from a local tree-sitter declaration index built from the workspace files, so a common lookup still succeeds without any server.`,
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

    // The layer-first rule: when nothing better exists locally, the local
    // declaration index is the first thing asked, and only its miss falls
    // through to a language server. When a server is configured it stays
    // authoritative, and the index is the second chance on its miss.
    const manager = getLspManager();
    const running = await manager.ensureStarted(currentWorkspaceRoot());
    if (running === 0) {
      const layer = await lookupLocalSymbols(currentWorkspaceRoot(), query);
      if (layer && layer.length > 0) {
        return localLayerAnswer(
          query,
          layer,
          "No language server is configured; a plugin can declare one under lspServers in its manifest.",
        );
      }
      return "No language server is configured, and the local declaration index has no match for this name. A plugin can declare one under lspServers in its manifest; Search or CodebaseSearch can still find uses of the name.";
    }

    const symbols = await manager.findSymbols(query);
    if (symbols.length === 0) {
      const layer = await lookupLocalSymbols(currentWorkspaceRoot(), query);
      if (layer && layer.length > 0) {
        return localLayerAnswer(
          query,
          layer,
          "The language server had no match for this name; these come from the workspace's local declaration index.",
        );
      }
      return `No symbol matched "${query}" in the language server, and the local declaration index has no match either.`;
    }

    const lines = symbols.map((symbol) => {
      const start = symbol.location?.range?.start;
      const where =
        typeof start?.line === "number"
          ? `${describeLspUri(symbol.location?.uri)}:${start.line + 1}:${(start.character ?? 0) + 1}`
          : describeLspUri(symbol.location?.uri);
      const kind = symbolKindName(symbol.kind);
      const container = symbol.containerName
        ? ` in ${symbol.containerName}`
        : "";
      return `${where} ${kind} ${symbol.name}${container}`;
    });
    return `${symbols.length} symbol(s) for "${query}":\n${lines.join("\n")}`;
  },
};
