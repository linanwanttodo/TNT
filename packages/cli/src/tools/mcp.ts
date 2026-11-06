import * as fs from "fs";
import * as path from "path";

import { logger } from "../utils/logger.js";
import { services } from "../services/index.js";
import type { MCPConnectionInfo, MCPTool } from "../services/types.js";

import type { ParameterSchema, Tool, ToolRunContext } from "./types.js";

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
  const readonly = mcpTool.annotations?.readOnlyHint === true;
  if (readonly) {
    // The runtime side table the concurrency planner reads: a tool the server
    // itself declares read-only may share a step instead of taking the whole
    // batch's exclusive slot.
    registerMcpSharedTool(toolName);
  }
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
    // The server's own hint: a read-only tool is the one case where the
    // permission layer's read-only narrowing (narrowReadOnlyAllow) is allowed
    // to reason about an MCP tool at all.
    readonly,
    isBuiltIn: false,
    // MCP tools have no per-call policy of their own, so the evaluation echoes
    // the base decision; declaring it is what routes the tool through the same
    // narrowing the built-ins go through instead of the static branch.
    evaluateToolCallPolicy: (basePolicy) => basePolicy,
    run: async (args: any, context?: ToolRunContext) => {
      // The wire call uses the name the server gave, so the server never sees
      // the namespace the model was shown.
      const result = await services.mcp?.runTool(
        mcpTool.name,
        args,
        serverName,
      );
      return await renderMcpToolResult(result, mcpTool.name, context);
    },
  };
}

/**
 * The runtime registry of MCP tool names the server hints are read-only
 * (`annotations.readOnlyHint`) lives in specs/concurrency (the planner reads
 * it); the builder feeds it here and the getter is re-exported so callers of
 * the mcp module see one surface.
 */
export { clearMcpSharedTools, getMcpSharedTools } from "./specs/concurrency.js";
import { registerMcpSharedTool } from "./specs/concurrency.js";

/** The subset of a CallToolResult's content blocks this renderer reads. */
interface McpContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; mimeType?: string };
}

function imageExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mimeType] ?? "bin";
}

/**
 * One image block out of the conversation: the base64 goes to the session's
 * tool-results directory (the same place oversized results spill) and the
 * model gets a pointer instead of a payload it cannot read.
 */
async function saveMcpImage(
  data: string,
  mimeType: string,
  callId: string,
  index: number,
): Promise<string | undefined> {
  try {
    // Loaded on demand, as in spillOversizedToolResult: the session module
    // pulls in the store not every entry point needs.
    const { getCurrentSession, getToolResultsDir } =
      await import("../session/index.js");
    const dir = getToolResultsDir(getCurrentSession().sessionId);
    const safeId = callId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
    const file = path.join(
      dir,
      `${safeId || "mcp"}-image-${index}.${imageExtension(mimeType)}`,
    );
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  } catch (error) {
    logger.warn("Could not store MCP tool image", {
      mimeType,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Renders a CallToolResult the way the model can use it: text blocks inline,
 * image blocks on disk behind a placeholder, resource blocks as a pointer to
 * their uri. An error result is not text for the transcript - it is a failed
 * tool call, so it throws and the pipeline records the call as errored.
 */
async function renderMcpToolResult(
  result: unknown,
  toolName: string,
  context?: ToolRunContext,
): Promise<string> {
  const payload = (result ?? {}) as {
    isError?: boolean;
    content?: McpContentBlock[];
  };

  if (payload.isError === true) {
    const detail = (payload.content ?? [])
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text as string)
      .join("\n")
      .trim();
    throw new Error(
      detail
        ? `MCP tool "${toolName}" failed: ${detail}`
        : `MCP tool "${toolName}" failed`,
    );
  }

  const parts: string[] = [];
  let imageIndex = 0;
  for (const block of payload.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image" && typeof block.data === "string") {
      const mimeType =
        typeof block.mimeType === "string" ? block.mimeType : "image/png";
      const saved = await saveMcpImage(
        block.data,
        mimeType,
        context?.toolCallId ?? "mcp",
        imageIndex++,
      );
      parts.push(
        saved
          ? `[image saved to ${saved} (${mimeType})]`
          : `[image (${mimeType}) could not be saved]`,
      );
    } else if (block.type === "resource") {
      const uri = block.resource?.uri ?? "";
      const mimeType = block.resource?.mimeType;
      parts.push(`[resource ${uri}${mimeType ? ` (${mimeType})` : ""}]`);
    }
  }
  return parts.join("\n");
}
