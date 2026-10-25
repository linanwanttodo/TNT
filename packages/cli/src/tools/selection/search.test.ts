import { describe, expect, it } from "vitest";

import type { Tool } from "../types.js";

import { formatToolMatches, matchDeferredTools, rankTools } from "./search.js";

function mcp(name: string, description?: string, padding = 0): Tool {
  return {
    name: `mcp__server__${name}`,
    displayName: name,
    description: `${description ?? "does something"}${" x".repeat(padding)}`,
    parameters: { type: "object", properties: {} },
    readonly: true,
    isBuiltIn: false,
    run: async () => "",
  };
}

describe("ranking the catalog", () => {
  const catalog = [
    mcp("list_issues", "List the issues in a project"),
    mcp("create_issue", "Create an issue with a title and body"),
    mcp("search_documents", "Search documents and create excerpts"),
  ];

  it("puts a name match ahead of a description match", () => {
    const ranked = rankTools(catalog, "create", 2);

    expect(ranked.map((entry) => entry.name)).toEqual([
      "mcp__server__create_issue",
      "mcp__server__search_documents",
    ]);
  });

  it("returns name order for an empty query", () => {
    const ranked = rankTools(catalog, "", 2);

    expect(ranked.map((entry) => entry.name)).toEqual([
      "mcp__server__create_issue",
      "mcp__server__list_issues",
    ]);
  });

  it("drops tools that match nothing instead of padding the answer", () => {
    expect(rankTools(catalog, "billing", 5)).toEqual([]);
  });
});

describe("the catalog answer", () => {
  it("says when nothing is deferred", () => {
    expect(formatToolMatches({ matches: [], total: 0, query: "x" })).toContain(
      "No deferred tools are available",
    );
  });

  it("names the total so a miss does not read as an empty server", () => {
    const answer = formatToolMatches({ matches: [], total: 9, query: "x" });

    expect(answer).toContain("9 tools are deferred");
    expect(answer).toContain("empty one");
  });

  it("carries the parameter schema the model has to call with", () => {
    const answer = formatToolMatches({
      matches: [mcp("create_issue", "Create an issue")],
      total: 1,
      query: "create",
    });

    expect(answer).toContain("mcp__server__create_issue");
    expect(answer).toContain('"type":"object"');
  });

  it("caps a large answer and points at the way to narrow it", () => {
    const wide = Array.from({ length: 20 }, (_, index) =>
      mcp(`tool_${index}`, "does something", 600),
    );

    const answer = formatToolMatches({
      matches: wide,
      total: wide.length,
      query: "",
    });

    expect(answer.length).toBeLessThanOrEqual(12_200);
    expect(answer).toContain("narrow the query");
  });
});

describe("matching deferred tools", () => {
  const catalog = [
    mcp("list_issues", "List the issues in a project"),
    mcp("create_issue", "Create an issue with a title"),
  ];

  it("selects exact names, case-insensitively", () => {
    const matched = matchDeferredTools(
      catalog,
      "select:MCP__SERVER__CREATE_ISSUE, missing",
      5,
    );

    expect(matched.map((entry) => entry.name)).toEqual([
      "mcp__server__create_issue",
    ]);
  });

  it("caps a select list at the requested limit", () => {
    const matched = matchDeferredTools(
      catalog,
      "select:mcp__server__list_issues,mcp__server__create_issue",
      1,
    );

    expect(matched).toHaveLength(1);
  });

  it("falls back to ranking for a normal query", () => {
    const matched = matchDeferredTools(catalog, "create", 5);

    expect(matched.map((entry) => entry.name)).toEqual([
      "mcp__server__create_issue",
    ]);
  });
});
