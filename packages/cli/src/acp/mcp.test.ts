import type * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import { toMcpServerConfig } from "./mcp.js";

describe("ACP MCP server mapping", () => {
  it("maps a stdio server and its name/value env list", () => {
    const server = {
      name: "local",
      command: "node",
      args: ["server.mjs"],
      env: [{ name: "TOKEN", value: "secret" }],
    } as acp.McpServer;

    expect(toMcpServerConfig(server)).toMatchObject({
      name: "local",
      command: "node",
      args: ["server.mjs"],
      env: { TOKEN: "secret" },
    });
  });

  it("maps HTTP and SSE servers with their header list", () => {
    const http = {
      name: "remote",
      type: "http",
      url: "https://example.test/mcp",
      headers: [{ name: "X-Key", value: "value" }],
    } as acp.McpServer;
    const sse = { ...http, type: "sse" } as acp.McpServer;

    expect(toMcpServerConfig(http)).toMatchObject({
      name: "remote",
      url: "https://example.test/mcp",
      type: "streamable-http",
      requestOptions: { headers: { "X-Key": "value" } },
    });
    expect(toMcpServerConfig(sse)).toMatchObject({
      type: "sse",
    });
  });
});
