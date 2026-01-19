import { afterEach, describe, expect, it } from "vitest";

import type { Tool } from "../types.js";

import {
  buildDeferredCatalog,
  isDeferredTool,
  isMcpTool,
  selectRequestTools,
  shouldDeferMcpTools,
  TOOL_SEARCH_NAME,
} from "./deferral.js";
import { toolSearchTool } from "./search.js";

function tool(name: string, description = "does something", padding = 0): Tool {
  return {
    name,
    displayName: name,
    description: `${description}${" x".repeat(padding)}`,
    parameters: { type: "object", properties: {} },
    readonly: true,
    isBuiltIn: false,
    run: async () => "",
  };
}

function mcp(name: string, description?: string, padding = 0): Tool {
  return tool(`mcp__server__${name}`, description, padding);
}

const ORIGINAL_OVERRIDE = process.env.CONTINUE_CLI_DEFER_MCP_TOOLS;
const ORIGINAL_BUILTIN_OVERRIDE = process.env.CONTINUE_CLI_DEFER_BUILTIN_TOOLS;

afterEach(() => {
  if (ORIGINAL_OVERRIDE === undefined) {
    delete process.env.CONTINUE_CLI_DEFER_MCP_TOOLS;
  } else {
    process.env.CONTINUE_CLI_DEFER_MCP_TOOLS = ORIGINAL_OVERRIDE;
  }
  if (ORIGINAL_BUILTIN_OVERRIDE === undefined) {
    delete process.env.CONTINUE_CLI_DEFER_BUILTIN_TOOLS;
  } else {
    process.env.CONTINUE_CLI_DEFER_BUILTIN_TOOLS = ORIGINAL_BUILTIN_OVERRIDE;
  }
});

describe("deciding what to advertise", () => {
  it("recognises only namespaced MCP tools", () => {
    expect(isMcpTool("mcp__github__list_issues")).toBe(true);
    expect(isMcpTool("Read")).toBe(false);
    expect(isMcpTool("mcp_github")).toBe(false);
  });

  it("keeps a normal MCP setup inline in a large window", () => {
    const tools = [
      tool("Read"),
      ...["linear", "notion", "sentry", "github", "slack"].map((name) =>
        mcp(name, "a short description of the server", 40),
      ),
    ];

    // Five servers with modest definitions are well under a tenth of 200k.
    expect(shouldDeferMcpTools(tools, { contextWindow: 200_000 })).toBe(false);
  });

  it("defers once the hidden definitions reach a tenth of the window", () => {
    const tools = [mcp("wide", "a long description", 6_000)];

    // About 3k tokens of schema: over a 16k window's share, under a 200k one.
    expect(shouldDeferMcpTools(tools, { contextWindow: 16_000 })).toBe(true);
    expect(shouldDeferMcpTools(tools, { contextWindow: 200_000 })).toBe(false);
  });

  it("treats the default window as a large one", () => {
    const tools = [mcp("wide", "a long description", 6_000)];

    expect(shouldDeferMcpTools(tools)).toBe(false);
  });

  it("has nothing to defer without an MCP server", () => {
    expect(shouldDeferMcpTools([tool("Read"), tool("Edit")])).toBe(false);
  });

  it("lets the operator force the decision either way", () => {
    const wide = ["a", "b", "c", "d", "e", "f"].map((name) => mcp(name));

    process.env.CONTINUE_CLI_DEFER_MCP_TOOLS = "0";
    expect(shouldDeferMcpTools(wide)).toBe(false);

    process.env.CONTINUE_CLI_DEFER_MCP_TOOLS = "1";
    expect(shouldDeferMcpTools([mcp("only")])).toBe(true);

    process.env.CONTINUE_CLI_DEFER_MCP_TOOLS = "auto";
    expect(shouldDeferMcpTools(wide)).toBe(false);
  });
});

describe("the tools a request advertises", () => {
  it("leaves the list untouched when nothing is hidden", () => {
    const tools = [tool("Read"), tool("Edit"), mcp("one")];

    const selected = selectRequestTools(tools).map((entry) => entry.name);

    expect(selected).toEqual(["Edit", "Read", "mcp__server__one"]);
    expect(selected).not.toContain(TOOL_SEARCH_NAME);
  });

  it("replaces a deferred surface with the catalog, in name order", () => {
    const tools = [
      tool("Write"),
      tool("Read"),
      toolSearchTool,
      ...["a", "b", "c", "d", "e", "f"].map((name) =>
        mcp(name, "a description", 2_000),
      ),
    ];

    const selected = selectRequestTools(tools, {
      contextWindow: 10_000,
    }).map((entry) => entry.name);

    expect(selected).toEqual(["Read", TOOL_SEARCH_NAME, "Write"]);
    expect(selected.some((name) => isMcpTool(name))).toBe(false);
  });

  it("leaves the same surface inline when the window is large", () => {
    const tools = [
      tool("Write"),
      tool("Read"),
      toolSearchTool,
      ...["a", "b", "c", "d", "e", "f"].map((name) =>
        mcp(name, "a description", 2_000),
      ),
    ];

    const selected = selectRequestTools(tools, {
      contextWindow: 200_000,
    }).map((entry) => entry.name);

    expect(selected).toContain("mcp__server__a");
    expect(selected).not.toContain(TOOL_SEARCH_NAME);
  });

  it("never advertises a catalog when there is nothing behind it", () => {
    const tools = [tool("Read"), tool(TOOL_SEARCH_NAME)];

    expect(selectRequestTools(tools).map((entry) => entry.name)).toEqual([
      "Read",
    ]);
  });

  it("keeps MCP tools visible when the catalog was not permitted", () => {
    const tools = [
      tool("Read"),
      ...["a", "b", "c", "d", "e", "f"].map((name) =>
        mcp(name, "a description", 2_000),
      ),
    ];

    const selected = selectRequestTools(tools, {
      contextWindow: 1_000,
    }).map((entry) => entry.name);

    expect(selected).toContain("mcp__server__a");
    expect(selected).not.toContain(TOOL_SEARCH_NAME);
  });
});

function builtin(
  name: string,
  description = "does something",
  padding = 0,
): Tool {
  return {
    name,
    displayName: name,
    description: `${description}${" x".repeat(padding)}`,
    parameters: { type: "object", properties: {} },
    readonly: true,
    isBuiltIn: true,
    run: async () => "",
  };
}

describe("deferred built-ins", () => {
  const situational = ["WebSearch", "Browser", "Computer", "NotebookEdit"];
  const core = ["Read", "Edit", "Bash", "Search"];

  it("withholds the situational set behind the catalog", () => {
    const tools = [
      ...core.map((name) => builtin(name)),
      ...situational.map((name) => builtin(name)),
      toolSearchTool,
    ];

    const selected = selectRequestTools(tools).map((entry) => entry.name);

    expect(selected).toEqual([...core, TOOL_SEARCH_NAME].sort());
    for (const name of situational) {
      expect(selected, name).not.toContain(name);
    }
  });

  it("keeps everything inline when the catalog is not permitted", () => {
    const tools = [
      ...core.map((name) => builtin(name)),
      ...situational.map((name) => builtin(name)),
    ];

    const selected = selectRequestTools(tools).map((entry) => entry.name);

    expect(selected).toEqual([...core, ...situational].sort());
  });

  it("lets the operator turn built-in deferral off", () => {
    process.env.CONTINUE_CLI_DEFER_BUILTIN_TOOLS = "0";
    const tools = [
      ...core.map((name) => builtin(name)),
      builtin("WebSearch"),
      toolSearchTool,
    ];

    const selected = selectRequestTools(tools).map((entry) => entry.name);

    expect(selected).toContain("WebSearch");
    expect(selected).not.toContain(TOOL_SEARCH_NAME);
  });

  it("builds a compact entry with a signature and one sentence", () => {
    const search = builtin("WebSearch", "Search the web. More detail follows.");
    search.parameters = {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "query" },
        max_results: { type: "number", description: "limit" },
      },
    };

    expect(buildDeferredCatalog([search])).toBe(
      "- WebSearch{query: string, max_results?: number}: Search the web.",
    );
  });

  it("classifies MCP and the situational set, not core tools", () => {
    expect(isDeferredTool(mcp("x"))).toBe(true);
    expect(isDeferredTool(builtin("WebSearch"))).toBe(true);
    expect(isDeferredTool(builtin("Read"))).toBe(false);
  });
});
