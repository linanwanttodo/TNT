import type { MCPConnectionInfo } from "../../services/types.js";

/**
 * Names of the MCP servers that failed to connect. Connections settle after
 * the startup banner is already on screen, so the caller reports these in the
 * transcript instead of the banner.
 */
export function collectFailedMcpServerNames(
  connections: MCPConnectionInfo[] | undefined,
): string[] {
  return (connections ?? [])
    .filter((connection) => connection.status === "error")
    .map((connection) => connection.config?.name ?? "unknown");
}
