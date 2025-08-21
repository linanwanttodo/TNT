import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { localPathOrUriToPath } from "core/util/pathToUri.js";

import { getRetrievalService } from "../retrieval/service.js";

import { Tool, ToolRunContext } from "./types.js";

const DEFAULT_RESULT_COUNT = 8;
const MAX_CHARS_PER_HIT = 1500;
const MAX_TOTAL_CHARS = 12000;

export const codebaseSearchTool: Tool = {
  name: "CodebaseSearch",
  displayName: "Codebase Search",
  description:
    "Full-text search over the workspace's code index. Matches on substrings, so it finds code by partial names and comments where exact patterns are unknown; results are chunked with file paths and line ranges. The index is built on first use. Use Search for exact patterns and regular expressions instead.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "Text to look for across the workspace, such as a symbol fragment or a phrase from a comment",
      },
      n: {
        type: "number",
        description: `Maximum number of chunks to return (default ${DEFAULT_RESULT_COUNT})`,
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        "query is required",
      );
    }
    const shown = query.length > 50 ? `${query.slice(0, 50)}...` : query;
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will search the codebase for: "${shown}"`,
        },
      ],
    };
  },
  run: async (
    args: { query: string; n?: number },
    context?: ToolRunContext,
  ) => {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        "query is required",
      );
    }
    const requested = Number(args?.n);
    const n =
      Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : DEFAULT_RESULT_COUNT;

    const service = getRetrievalService();
    await service.ensureIndexed();
    const hits = await service.search(query, n);

    if (hits.length === 0) {
      return `No matches for "${query}".`;
    }

    const limit = Math.max(
      2000,
      Math.floor(MAX_TOTAL_CHARS / (context?.parallelToolCallCount ?? 1)),
    );
    const sections: string[] = [];
    let used = 0;
    for (const hit of hits) {
      const filepath = localPathOrUriToPath(hit.filepath);
      const content =
        hit.content.length > MAX_CHARS_PER_HIT
          ? `${hit.content.slice(0, MAX_CHARS_PER_HIT)}\n[chunk truncated]`
          : hit.content;
      const section = `${filepath}:${hit.startLine}:${hit.endLine}\n${content}`;
      if (used + section.length > limit) {
        sections.push(`[more matches omitted]`);
        break;
      }
      sections.push(section);
      used += section.length;
    }

    const header =
      hits.length === 1 ? "1 match:" : `${hits.length} matches, best first:`;
    return `${header}\n\n${sections.join("\n\n")}`;
  },
};
