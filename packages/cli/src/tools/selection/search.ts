import { sortToolsByName } from "../stableOrder.js";
import type { Tool } from "../types.js";

import { isMcpTool, TOOL_SEARCH_NAME } from "./deferral.js";

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;

/** One result can carry a full parameter schema, so the whole answer is capped. */
const MAX_OUTPUT_CHARS = 12_000;

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function scoreTool(tool: Tool, query: string, tokens: string[]): number {
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  let score = 0;

  if (name.includes(query)) {
    score += 8;
  }
  if (description.includes(query)) {
    score += 4;
  }
  for (const token of tokens) {
    if (name.includes(token)) {
      score += 3;
    } else if (description.includes(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Ranks the catalog by the words in the query. A name match outranks a
 * description match, because the name is what the model has to call.
 */
export function rankTools(
  tools: readonly Tool[],
  query: string,
  limit: number,
): Tool[] {
  const normalized = query.trim().toLowerCase();
  const ordered = sortToolsByName(tools);

  if (!normalized) {
    return ordered.slice(0, limit);
  }

  const tokens = queryTokens(normalized);
  return ordered
    .map((tool) => ({ tool, score: scoreTool(tool, normalized, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.tool.name < b.tool.name ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry.tool);
}

function firstSentence(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, " ");
  const end = trimmed.indexOf(". ");
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_SEARCH_LIMIT);
}

export function formatToolMatches(options: {
  matches: readonly Tool[];
  total: number;
  query: string;
}): string {
  const { matches, total, query } = options;
  if (matches.length === 0) {
    return total === 0
      ? "No MCP tools are connected in this session."
      : `No MCP tool matches ${JSON.stringify(query)}. ${total} tools are connected; call this again with a broader query or an empty one to list them.`;
  }

  const header = query
    ? `${matches.length} of ${total} MCP tools match ${JSON.stringify(query)}. Call a name below directly with the parameters shown.`
    : `${matches.length} of ${total} MCP tools, in name order. Call a name below directly with the parameters shown.`;

  let output = header;
  for (const tool of matches) {
    const entry = `\n\n${tool.name}\n${firstSentence(
      tool.description,
    )}\nparameters: ${JSON.stringify(tool.parameters)}`;
    if (output.length + entry.length > MAX_OUTPUT_CHARS) {
      output += `\n\n[output capped at ${MAX_OUTPUT_CHARS.toLocaleString(
        "en-US",
      )} characters; narrow the query to see the rest]`;
      break;
    }
    output += entry;
  }
  return output;
}

export const toolSearchTool: Tool = {
  name: TOOL_SEARCH_NAME,
  displayName: "Tool Search",
  description: `Find the MCP tools connected in this session and get their full parameter schema.
Several MCP tools are not listed among this request's tool definitions; their names and arguments live behind this tool. Search here before concluding an external capability is missing, then call the returned name directly.
Query with the capability you need, such as "create an issue" or "search documents". An empty query lists the connected tools by name. Results rank a name match above a description match.`,
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "What the tool should do. Use an empty string to list every connected MCP tool.",
      },
      limit: {
        type: "number",
        description: `Maximum results to return, default ${DEFAULT_SEARCH_LIMIT} and at most ${MAX_SEARCH_LIMIT}.`,
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async (args: { query?: unknown; limit?: unknown }): Promise<string> => {
    const query = typeof args?.query === "string" ? args.query.trim() : "";

    // Loaded here rather than imported at the top: this module is part of the
    // registry `index.tsx` assembles, so a static import would close a cycle.
    const { getAllAvailableTools } = await import("../index.js");
    const available = await getAllAvailableTools(false, true);
    const mcpTools = available.filter((tool) => isMcpTool(tool.name));

    const matches = rankTools(mcpTools, query, clampLimit(args?.limit));
    return formatToolMatches({ matches, total: mcpTools.length, query });
  },
};
