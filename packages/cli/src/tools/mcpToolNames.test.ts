import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SERVICE_NAMES, serviceContainer } from "../services/index.js";
import { services } from "../services/index.js";
import type {
  MCPConnectionInfo,
  MCPServiceState,
  MCPTool,
  ModelServiceState,
} from "../services/types.js";

import {
  convertMcpToolToContinueTool,
  getAllAvailableTools,
  mcpToolName,
  mcpToolsFromConnections,
} from "./index.js";
import { setBetaSubagentToolEnabled } from "./toolsConfig.js";

function tool(name: string): MCPTool {
  return {
    name,
    description: `the ${name} tool`,
    inputSchema: { type: "object", properties: {}, required: [] },
  } as unknown as MCPTool;
}

function server(
  name: string,
  toolNames: string[],
  status: MCPConnectionInfo["status"] = "connected",
): MCPConnectionInfo {
  return {
    config: { name },
    status,
    tools: toolNames.map(tool),
    prompts: [],
    warnings: [],
  } as unknown as MCPConnectionInfo;
}

describe("MCP tool names", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("namespaces a tool with the server that owns it", () => {
    const tools = mcpToolsFromConnections([server("github", ["create_issue"])]);

    expect(tools.map((t) => t.name)).toEqual(["mcp__github__create_issue"]);
  });

  it("keeps two servers that export the same tool name apart", () => {
    const tools = mcpToolsFromConnections([
      server("search", ["fetch"]),
      server("files", ["fetch"]),
    ]);

    // A request that lists one name twice is refused by the provider, and the
    // second server was previously reachable by no name at all.
    expect(tools.map((t) => t.name)).toEqual([
      "mcp__search__fetch",
      "mcp__files__fetch",
    ]);
  });

  it("replaces characters a provider will not accept in a tool name", () => {
    expect(mcpToolName("file system", "read.file")).toBe(
      "mcp__file_system__read_file",
    );
  });

  it("stays inside the length a provider allows", () => {
    const long = mcpToolName("a".repeat(40), "b".repeat(60));

    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^mcp__a{40}__b+$/);
  });

  it("numbers names that collide after sanitizing", () => {
    const tools = mcpToolsFromConnections([
      server("a.b", ["x"]),
      server("a/b", ["x"]),
    ]);

    expect(tools.map((t) => t.name)).toEqual(["mcp__a_b__x", "mcp__a_b__x_2"]);
  });

  it("offers nothing from a server that is not connected", () => {
    const tools = mcpToolsFromConnections([
      server("down", ["a"], "error"),
      server("live", ["b"]),
    ]);

    expect(tools.map((t) => t.name)).toEqual(["mcp__live__b"]);
  });

  it("calls the server with the name that server gave", async () => {
    const runTool = vi
      .spyOn(services.mcp, "runTool")
      .mockResolvedValue({ content: [] } as never);
    const [listed] = mcpToolsFromConnections([server("github", ["create"])]);

    await listed.run({ title: "x" });

    expect(runTool).toHaveBeenCalledWith("create", { title: "x" }, "github");
  });

  it("reaches each of two same-named tools through its own name", async () => {
    const runTool = vi
      .spyOn(services.mcp, "runTool")
      .mockResolvedValue({ content: [] } as never);
    const tools = mcpToolsFromConnections([
      server("search", ["fetch"]),
      server("files", ["fetch"]),
    ]);

    await tools[0].run({ q: "1" });
    await tools[1].run({ path: "/tmp" });

    expect(runTool).toHaveBeenNthCalledWith(1, "fetch", { q: "1" }, "search");
    expect(runTool).toHaveBeenNthCalledWith(
      2,
      "fetch",
      {
        path: "/tmp",
      },
      "files",
    );
  });

  it("still converts a single tool handed to it directly", () => {
    const converted = convertMcpToolToContinueTool(
      tool("x"),
      "srv",
      "mcp__srv__x",
    );

    expect(converted.name).toBe("mcp__srv__x");
    expect(converted.description).toBe("the x tool");
    expect(converted.isBuiltIn).toBe(false);
  });

  it("offers the namespaced name to the permission policy", async () => {
    setBetaSubagentToolEnabled(false);
    serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
      model: { name: "test-model" },
    } as unknown as ModelServiceState);
    const mcpState: MCPServiceState = {
      mcpService: null,
      connections: [server("github", ["push"])],
      tools: [tool("push")],
      prompts: [],
    };
    serviceContainer.registerValue(SERVICE_NAMES.MCP, mcpState);

    const offered = (await getAllAvailableTools(false, false)).map(
      (t) => t.name,
    );

    expect(offered).toContain("mcp__github__push");
    expect(offered).not.toContain("push");
    // No name is offered twice, which is what a provider refuses.
    expect(new Set(offered).size).toBe(offered.length);
  });
});
