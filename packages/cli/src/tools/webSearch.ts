import { TntError, TntErrorReason } from "core/util/errors.js";

import { Tool } from "./types.js";

const DEFAULT_SEARCH_URL = "https://lite.duckduckgo.com/lite/";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 500_000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps result links in a redirect; the target is in `uddg`. */
function resolveResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, DEFAULT_SEARCH_URL);
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return decoded;
  }
}

/**
 * The lite HTML page is a table: each result link is followed by its own
 * snippet cell, and a result with nothing to show emits no cell at all. So this
 * is one scan in document order and a snippet can only attach to the link that
 * preceded it. Collecting links and snippets as two lists and pairing them by
 * index shifted every later snippet onto the wrong result the moment one was
 * missing - a citation the model has no way to distrust.
 */
export function parseDuckDuckGoLite(
  html: string,
  count: number = DEFAULT_COUNT,
): SearchResult[] {
  const results: SearchResult[] = [];
  let owed: SearchResult | undefined;
  for (const match of html.matchAll(
    /<a\b[^>]*>[\s\S]*?<\/a>|<td\b[^>]*class=['"]result-snippet['"][^>]*>[\s\S]*?<\/td>/gi,
  )) {
    const tag = match[0];
    if (/^<a\b/i.test(tag)) {
      if (!/class=['"]result-link['"]/i.test(tag)) {
        continue;
      }
      const href = /href=['"]([^'"]+)['"]/i.exec(tag)?.[1];
      if (!href) {
        continue;
      }
      if (results.length >= count) {
        break;
      }
      owed = {
        title: cleanText(
          tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""),
        ),
        url: resolveResultUrl(href),
        snippet: "",
      };
      results.push(owed);
      continue;
    }
    // The most recent link that is still owed one - never an earlier one, and
    // never a second cell for a link that already has its snippet.
    if (!owed || owed.snippet !== "") {
      continue;
    }
    owed.snippet = cleanText(
      tag.replace(/^<td\b[^>]*>/i, "").replace(/<\/td>$/i, ""),
    );
  }
  return results;
}

function boundedCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COUNT;
  }
  return Math.min(Math.floor(parsed), MAX_COUNT);
}

async function searchJsonEndpoint(
  query: string,
  count: number,
): Promise<SearchResult[]> {
  const endpoint = new URL(process.env.TNT_WEB_SEARCH_URL as string);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(count));

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.TNT_WEB_SEARCH_KEY;
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const response = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Web search failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.text()).slice(0, MAX_BODY_CHARS);
  const parsed = JSON.parse(body) as { results?: unknown };
  const raw = Array.isArray(parsed.results) ? parsed.results : [];
  return raw
    .slice(0, count)
    .map((entry) => {
      const item = entry as {
        title?: unknown;
        url?: unknown;
        description?: unknown;
        snippet?: unknown;
      };
      return {
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        snippet: String(item.description ?? item.snippet ?? ""),
      };
    })
    .filter((result) => result.url !== "");
}

async function searchPublicHtml(
  query: string,
  count: number,
): Promise<SearchResult[]> {
  const endpoint = new URL(DEFAULT_SEARCH_URL);
  endpoint.searchParams.set("q", query);
  const response = await fetch(endpoint, {
    headers: {
      Accept: "text/html",
      "User-Agent": "TNT-CLI",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Web search failed: ${response.status} ${response.statusText}`,
    );
  }
  const html = (await response.text()).slice(0, MAX_BODY_CHARS);
  return parseDuckDuckGoLite(html, count);
}

export const webSearchTool: Tool = {
  name: "WebSearch",
  displayName: "Web Search",
  description: `Search the web and return titles, URLs and short snippets. Use it when the answer depends on something outside the workspace: current documentation, a release note, an error message from a project this repository does not contain, or a fact the model may have stale.
The default endpoint is a public HTML search page and can be rate-limited; set TNT_WEB_SEARCH_URL to a JSON endpoint that returns {"results":[{"title","url","description"}]}, and TNT_WEB_SEARCH_KEY if it needs a bearer token. Results are search snippets, not evidence: open a promising page with Fetch before relying on its content.`,
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      count: {
        type: "number",
        description: `How many results to return (default ${DEFAULT_COUNT}, maximum ${MAX_COUNT})`,
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => ({
    args,
    preview: [
      {
        type: "text",
        content: `Will search the web for: "${String(args?.query ?? "")}"`,
      },
    ],
  }),
  run: async (args: { query: string; count?: number }): Promise<string> => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "WebSearch needs a query.",
      );
    }
    const count = boundedCount(args.count);
    const results = process.env.TNT_WEB_SEARCH_URL
      ? await searchJsonEndpoint(query, count)
      : await searchPublicHtml(query, count);

    if (results.length === 0) {
      return `No web results for "${query}".`;
    }
    const lines = results.map(
      (result, index) =>
        `${index + 1}. ${result.title}\n   ${result.url}${
          result.snippet ? `\n   ${result.snippet}` : ""
        }`,
    );
    return `Web results for "${query}":\n\n${lines.join("\n\n")}`;
  },
};
