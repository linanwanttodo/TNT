import * as http from "http";
import type { AddressInfo } from "net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDuckDuckGoLite, webSearchTool } from "./webSearch.js";

let server: http.Server;
let base: string;
let lastUrl: URL | undefined;
let lastAuthorization: string | undefined;

beforeEach(async () => {
  server = http.createServer((req, res) => {
    lastUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    lastAuthorization = req.headers.authorization;
    if (lastUrl.pathname === "/fail") {
      res.writeHead(500);
      res.end("no");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (lastUrl.pathname === "/empty") {
      res.end(JSON.stringify({ results: [] }));
      return;
    }
    res.end(
      JSON.stringify({
        results: [
          {
            title: "TS handbook",
            url: "https://example.com/ts",
            description: "The language reference.",
          },
          {
            title: "TS release notes",
            url: "https://example.com/releases",
            description: "What changed.",
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("parseDuckDuckGoLite", () => {
  it("reads titles, resolved links and snippets", () => {
    const html = [
      `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x" class="result-link">Example <b>A</b></a>`,
      `<td class="result-snippet">A &amp; B</td>`,
      `<a rel="nofollow" href="https://example.com/b" class="result-link">Example B</a>`,
      `<td class="result-snippet">Second</td>`,
    ].join("\n");

    expect(parseDuckDuckGoLite(html, 2)).toEqual([
      {
        title: "Example A",
        url: "https://example.com/a",
        snippet: "A & B",
      },
      {
        title: "Example B",
        url: "https://example.com/b",
        snippet: "Second",
      },
    ]);
  });

  it("returns nothing for a page with no result links", () => {
    expect(parseDuckDuckGoLite("<html><body>no results</body></html>")).toEqual(
      [],
    );
  });

  it("keeps a snippet with the result it followed", () => {
    // The lite page emits a `result-snippet` cell only when there is something
    // to show, so a page can carry three links and two snippets. Pairing the
    // two lists by index - which this parser used to do - hands the third
    // result's snippet to the second one and reports the real pair as empty,
    // i.e. a citation the model believes because nothing contradicted it.
    const html = [
      `<a href="https://example.com/a" class="result-link">First</a>`,
      `<td class="result-snippet">One</td>`,
      `<a href="https://example.com/b" class="result-link">Second</a>`,
      `<a href="https://example.com/c" class="result-link">Third</a>`,
      `<td class="result-snippet">Three</td>`,
    ].join("\n");

    expect(parseDuckDuckGoLite(html, 3)).toEqual([
      { title: "First", url: "https://example.com/a", snippet: "One" },
      { title: "Second", url: "https://example.com/b", snippet: "" },
      { title: "Third", url: "https://example.com/c", snippet: "Three" },
    ]);
  });
});

describe("WebSearch", () => {
  it("uses the configured JSON endpoint and formats its results", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", `${base}/search`);
    vi.stubEnv("TNT_WEB_SEARCH_KEY", "secret");

    const text = await webSearchTool.run!({ query: "typescript", count: 2 });

    expect(text).toContain('Web results for "typescript":');
    expect(text).toContain("1. TS handbook");
    expect(text).toContain("https://example.com/ts");
    expect(text).toContain("The language reference.");
    expect(lastUrl?.searchParams.get("q")).toBe("typescript");
    expect(lastUrl?.searchParams.get("count")).toBe("2");
    expect(lastAuthorization).toBe("Bearer secret");
  });

  it("caps the requested count at ten", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", `${base}/search`);

    await webSearchTool.run!({ query: "typescript", count: 50 });

    expect(lastUrl?.searchParams.get("count")).toBe("10");
  });

  it("says when the endpoint returned nothing", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", `${base}/empty`);

    await expect(webSearchTool.run!({ query: "nothing" })).resolves.toContain(
      'No web results for "nothing"',
    );
  });

  it("reports an endpoint failure", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", `${base}/fail`);

    await expect(webSearchTool.run!({ query: "typescript" })).rejects.toThrow(
      /Web search failed: 500/,
    );
  });

  it("refuses an empty query", async () => {
    await expect(webSearchTool.run!({ query: "  " })).rejects.toThrow(
      /needs a query/,
    );
  });

  it("previews the query", async () => {
    const processed = await webSearchTool.preprocess!({ query: "typescript" });

    expect(JSON.stringify(processed.preview)).toContain("typescript");
  });
});
