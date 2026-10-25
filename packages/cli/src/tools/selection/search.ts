import { sortToolsByName } from "../stableOrder.js";
import type { Tool } from "../types.js";

import { isDeferredTool, TOOL_SEARCH_NAME } from "./deferral.js";

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
      ? "No deferred tools are available in this session."
      : `No deferred tool matches ${JSON.stringify(query)}. ${total} tools are deferred; call this again with a broader query or an empty one to list them.`;
  }

  const header = query
    ? `${matches.length} of ${total} deferred tools match ${JSON.stringify(query)}. Call a name below directly with the parameters shown.`
    : `${matches.length} of ${total} deferred tools, in name order. Call a name below directly with the parameters shown.`;

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

/**
 * A `select:` query names tools exactly; anything else ranks. The exact form
 * exists because a model that already knows the name should not have to guess
 * how the ranker will score it.
 */
export function matchDeferredTools(
  tools: readonly Tool[],
  query: string,
  limit: number,
): Tool[] {
  const selected = /^select:(.*)$/i.exec(query.trim());
  if (!selected) {
    return rankTools(tools, query, limit);
  }
  const names = selected[1]
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const byName = new Map(tools.map((tool) => [tool.name.toLowerCase(), tool]));
  const matched: Tool[] = [];
  for (const name of names) {
    const tool = byName.get(name);
    if (tool && !matched.includes(tool)) {
      matched.push(tool);
    }
    if (matched.length >= limit) {
      break;
    }
  }
  return matched;
}

export const toolSearchTool: Tool = {
  name: TOOL_SEARCH_NAME,
  displayName: "Tool Search",
  description: `Find the tools this request withheld and get their full parameter schema.
Situational built-ins (web, GUI, notebook, LSP and similar) and connected MCP tools are listed under "Deferred tools" instead of being attached to the request. Search here before concluding a capability is missing, then call the returned name directly.
Query with the capability you need, such as "search the web" or "create an issue". Prefix with select: and comma-separate exact names to load those. An empty query lists the deferred tools by name. Results rank a name match above a description match.`,
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
    const deferred = available.filter(isDeferredTool);

    const matches = matchDeferredTools(
      deferred,
      query,
      clampLimit(args?.limit),
    );
    return formatToolMatches({ matches, total: deferred.length, query });
  },
};
