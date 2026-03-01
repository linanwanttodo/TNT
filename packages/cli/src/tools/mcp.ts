import { services } from "../services/index.js";
import type { MCPConnectionInfo, MCPTool } from "../services/types.js";

import type { ParameterSchema, Tool } from "./types.js";

/**
 * MCP tools are the one part of the surface this package does not declare: the
 * name the model is shown has to be derived from the server and the tool, and
 * the call has to be translated back to the name the server chose. Keeping that
 * translation in one module means the registry, the permission rules and the
 * hook matcher can all read the same naming rule.
 */

/**
 * The name a model is offered for one MCP tool. Two servers can both export a
 * tool called "fetch", and a request that lists the name twice is a request the
 * provider refuses, so the server is part of the name the way it is in the
 * reference: `mcp__<server>__<tool>`. That also makes the name a permission rule
 * an author can write (`mcp__github_*`), and the hook's tool_name is the same
 * string, so PreToolUse `if` patterns match it.
 */
export const MCP_TOOL_NAME_LIMIT = 64;

function mcpNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function mcpToolName(serverName: string, toolName: string): string {
  const composed = `mcp__${mcpNameSegment(serverName)}__${mcpNameSegment(toolName)}`;
  return composed.slice(0, MCP_TOOL_NAME_LIMIT);
}

/** Numbers a name that another server already took after sanitizing. */
function uniqueToolName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    name = `${base.slice(0, MCP_TOOL_NAME_LIMIT - 3)}_${n}`;
  }
  taken.add(name);
  return name;
}

/**
 * The tools of the servers that are actually connected, each tagged with the
 * server that owns it. The flat `state.tools` list cannot express that, which is
 * why two servers with the same tool name used to collapse onto the first one.
 */
export function mcpToolsFromConnections(
  connections: MCPConnectionInfo[],
): Tool[] {
  const tools: Tool[] = [];
  const taken = new Set<string>();
  for (const connection of connections) {
    if (connection.status !== "connected") continue;
    const serverName = connection.config.name ?? "";
    for (const tool of connection.tools) {
      tools.push(
        convertMcpToolToInternalTool(
          tool,
          serverName,
          uniqueToolName(mcpToolName(serverName, tool.name), taken),
        ),
      );
    }
  }
  return tools;
}

export function convertMcpToolToInternalTool(
  mcpTool: MCPTool,
  serverName: string,
  toolName: string,
): Tool {
  return {
    name: toolName,
    displayName: toolName,
    description: mcpTool.description ?? "",
    parameters: {
      type: "object",
      properties: (mcpTool.inputSchema.properties ?? {}) as Record<
        string,
        ParameterSchema
      >,
      required: mcpTool.inputSchema.required,
    },
    readonly: undefined, // MCP tools don't have readonly property
    isBuiltIn: false,
    run: async (args: any) => {
      // The wire call uses the name the server gave, so the server never sees
      // the namespace the model was shown.
      const result = await services.mcp?.runTool(
        mcpTool.name,
        args,
        serverName,
      );
      return JSON.stringify(result?.content) ?? "";
    },
  };
}
