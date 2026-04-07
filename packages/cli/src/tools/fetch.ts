import type { ContextItem } from "core/index.js";
import { fetchUrlContentImpl } from "core/tools/implementations/fetchUrlContent.js";
import { TntError, TntErrorReason } from "core/util/errors.js";

import { parseEnvNumber } from "../utils/truncateOutput.js";

import { cachedFetch, rememberFetch } from "./fetchCache.js";
import { Tool } from "./types.js";

// Output truncation defaults
const DEFAULT_FETCH_MAX_CHARS = 20000;

function getFetchMaxChars(): number {
  return parseEnvNumber(
    process.env.TNT_FETCH_MAX_OUTPUT_LENGTH,
    DEFAULT_FETCH_MAX_CHARS,
  );
}

/**
 * One page of the page: the characters the caller asked for, and - when there
 * are more - the offset that reads the next ones. The full text is what the
 * cache holds, so paging a long document walks one fetch, not one request per
 * chunk.
 */
function pageOf(content: string, offset: number, pageSize: number): string {
  const total = content.length;
  if (offset >= total) {
    return total === 0
      ? ""
      : `[no content at offset ${offset}: the page has ${total} characters]`;
  }
  const end = Math.min(total, offset + pageSize);
  const body = content.slice(offset, end);
  return end < total
    ? `${body}\n\n[characters ${offset}-${end} of ${total}; fetch again with offset ${end} for the rest]`
    : body;
}

export const fetchTool: Tool = {
  name: "Fetch",
  displayName: "Fetch",
  description:
    "Read one URL and return the page as markdown. A non-2xx response reports its status. A long page comes back one part at a time: the result ends with the characters it covered and the offset that reads the rest, so pass that offset to continue instead of fetching the URL again - a page read within the last ten minutes is answered from the cache, which is what makes paging cheap. Scripts do not run, so a page that builds itself in the browser can come back nearly empty - that is not evidence that the page has nothing, so try another source or a deeper link rather than concluding. Fetches one URL per call.",
  parameters: {
    type: "object",
    required: ["url"],
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch content from",
      },
      offset: {
        type: "integer",
        description:
          "Character offset to start reading from, zero or more; use the value the previous result reported",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    return {
      preview: [
        {
          type: "text",
          content: `Will fetch: ${args.url}`,
        },
      ],
      args,
    };
  },
  run: async (args: { url: string; offset?: number }): Promise<string> => {
    const { url } = args;
    const pageSize = getFetchMaxChars();
    const requested = Number.isInteger(args.offset)
      ? (args.offset as number)
      : 0;
    const offset = requested > 0 ? requested : 0;

    try {
      const cached = cachedFetch(url);
      if (cached !== undefined) {
        return pageOf(cached, offset, pageSize);
      }

      // Suppress console errors from JSDOM CSS parsing
      const originalConsoleError = console.error;
      console.error = () => {};

      // Use the core fetchUrlContent implementation
      const contextItems = await fetchUrlContentImpl({ url }, { fetch });

      // Restore console.error
      console.error = originalConsoleError;

      if (contextItems.length === 0) {
        throw new TntError(
          TntErrorReason.Unspecified,
          `Could not fetch content from ${url}`,
        );
      }

      // Format the results for CLI display
      const combinedContent = contextItems
        .filter((item: ContextItem) => item.name !== "Truncation warning")
        .map((item: ContextItem) => item.content)
        .join("\n\n");

      // The cache holds the whole page: paging must not depend on how much of
      // it this particular call was asked to show.
      rememberFetch(url, combinedContent);
      return pageOf(combinedContent, offset, pageSize);
    } catch (error) {
      if (error instanceof TntError) {
        throw error;
      }
      throw new Error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
