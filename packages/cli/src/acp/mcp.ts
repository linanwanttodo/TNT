import type * as acp from "@agentclientprotocol/sdk";

import type { MCPServerConfig } from "../services/types.js";

/**
 * ACP describes MCP servers per session. TNT's configured-server shape accepts
 * the same stdio/HTTP/SSE transports, so the only work is renaming `headers`
 * and `env` arrays into the record forms the transport constructors read.
 */
export function toMcpServerConfig(server: acp.McpServer): MCPServerConfig {
  if (!("url" in server)) {
    return {
      name: server.name,
      command: server.command,
      args: server.args,
      env: Object.fromEntries(
        (server.env ?? []).map((entry) => [entry.name, entry.value]),
      ),
    } as MCPServerConfig;
  }

  return {
    name: server.name,
    url: server.url,
    type: server.type === "sse" ? "sse" : "streamable-http",
    requestOptions: {
      headers: Object.fromEntries(
        (server.headers ?? []).map((header) => [header.name, header.value]),
      ),
    },
  } as MCPServerConfig;
}
