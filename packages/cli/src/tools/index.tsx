// @ts-ignore
import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { ChatCompletionTool } from "openai/resources.mjs";

import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";
import type {
  MCPConnectionInfo,
  MCPServiceState,
  MCPTool,
  ModelServiceState,
} from "../services/types.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { logger } from "../utils/logger.js";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { askQuestionTool } from "./askQuestion.js";
import { checkBackgroundJobTool } from "./checkBackgroundJob.js";
import { codebaseSearchTool } from "./codebaseSearch.js";
import { completionTool } from "./completion.js";
import { diagnosticsTool } from "./diagnostics.js";
import { editTool } from "./edit.js";
import { exitTool } from "./exit.js";
import { fetchTool } from "./fetch.js";
import { findSymbolTool } from "./findSymbol.js";
import { hoverTool } from "./hover.js";
import { listFilesTool } from "./listFiles.js";
import { multiEditTool } from "./multiEdit.js";
import { readFileTool } from "./readFile.js";
import { reportFailureTool } from "./reportFailure.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { checkIfRipgrepIsInstalled, searchCodeTool } from "./searchCode.js";
import { skillsTool } from "./skills.js";
import { sortToolsByName } from "./stableOrder.js";
import { statusTool } from "./status.js";
import { listSubagentsTool, subagentTool } from "./subagent.js";
import { todoTool } from "./todo.js";
import {
  isBetaSubagentToolEnabled,
  isBetaUploadArtifactToolEnabled,
} from "./toolsConfig.js";
import {
  type Tool,
  type ToolCall,
  type ToolParametersSchema,
  type ToolRunContext,
  ParameterSchema,
  PreprocessedToolCall,
} from "./types.js";
import { uploadArtifactTool } from "./uploadArtifact.js";
import { viewDiffTool } from "./viewDiff.js";
import { writeChecklistTool } from "./writeChecklist.js";
import { writeFileTool } from "./writeFile.js";

export type { Tool, ToolCall, ToolParametersSchema };

/**
 * Extract the agent ID from the --id command line flag
 */
function getAgentIdFromArgs(): string | undefined {
  const args = process.argv;
  const idIndex = args.indexOf("--id");
  if (idIndex !== -1 && idIndex + 1 < args.length) {
    return args[idIndex + 1];
  }
  return undefined;
}

// Base tools that are always available
const BASE_BUILTIN_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  listFilesTool,
  runTerminalCommandTool,
  fetchTool,
  writeChecklistTool,
  checkBackgroundJobTool,
  askQuestionTool,
];

const BUILTIN_SEARCH_TOOLS: Tool[] = [searchCodeTool];

/**
 * Tools that need nothing outside the workspace to answer. The language-server
 * tools are in this list even though most projects have no server: each one
 * returns the message that says a plugin must declare one, which tells the
 * model more than an invisible tool does, and the permission policies already
 * assume they exist. A tool that has a policy but is never offered is a dead
 * rule, and a project that wants it gone can deny it through the policies.
 */
const WORKSPACE_TOOLS: Tool[] = [
  todoTool,
  viewDiffTool,
  codebaseSearchTool,
  diagnosticsTool,
  findSymbolTool,
  hoverTool,
  completionTool,
];

// Get all builtin tools including dynamic ones, with capability-based filtering
export async function getAllAvailableTools(
  isHeadless: boolean,
  /**
   * Whether this run may delegate again. A run that has reached its depth
   * limit does not receive the delegation tool at all: an absent tool costs
   * no schema tokens and gives the model nothing to attempt, which is a
   * stronger guard than refusing a call it can already see.
   */
  canDelegate: boolean = true,
): Promise<Tool[]> {
  const tools = [...BASE_BUILTIN_TOOLS, ...WORKSPACE_TOOLS];

  const isRipgrepInstalled = await checkIfRipgrepIsInstalled();
  if (isRipgrepInstalled) {
    tools.push(...BUILTIN_SEARCH_TOOLS);
  }

  // Add agent-specific tools if agent ID is present
  // (these require --id to function and will confuse the agent if unavailable)
  const agentId = getAgentIdFromArgs();
  if (agentId) {
    tools.push(reportFailureTool, statusTool);

    // UploadArtifact tool is gated behind beta flag
    if (isBetaUploadArtifactToolEnabled()) {
      tools.push(uploadArtifactTool);
    }
  }

  const modelState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );
  if (!modelState.model) {
    throw new Error("Model service is not initialized");
  }

  // Both edit tools are offered. Which one a model handles well cannot be
  // told from its name, and a project that wants only one can exclude the
  // other through the permission policies.
  tools.push(editTool, multiEditTool);

  if (isHeadless) {
    tools.push(exitTool);
  }

  if (isBetaSubagentToolEnabled() && canDelegate) {
    tools.push(await subagentTool());
    tools.push(await listSubagentsTool());
  }

  tools.push(await skillsTool());

  const mcpState = await serviceContainer.get<MCPServiceState>(
    SERVICE_NAMES.MCP,
  );
  tools.push(...mcpToolsFromConnections(mcpState.connections));

  // Registration order depends on which optional tools are present and on the
  // order a provider happens to return MCP tools in. Tool definitions are part
  // of the cached prompt prefix, so the order has to be a pure function of the
  // names rather than of how the list was assembled.
  return sortToolsByName(tools);
}

export function getToolDisplayName(toolName: string): string {
  const tool = ALL_BUILT_IN_TOOLS.find((t) => t.name === toolName);
  return tool?.displayName || toolName;
}

export function extractToolCalls(
  response: string,
): Array<{ name: string; arguments: Record<string, any> }> {
  const toolCallRegex = /<tool>([\s\S]*?)<\/tool>/g;
  const matches = [...response.matchAll(toolCallRegex)];

  const toolCalls = [];

  for (const match of matches) {
    try {
      const toolCallJson = JSON.parse(match[1]);
      if (toolCallJson.name && toolCallJson.arguments) {
        toolCalls.push({
          name: toolCallJson.name,
          arguments: toolCallJson.arguments,
        });
      }
    } catch {
      logger.error("Failed to parse tool call:", { toolCall: match[1] });
    }
  }

  return toolCalls;
}

export function convertToolToChatCompletionTool(
  tool: Tool,
): ChatCompletionTool {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        required: tool.parameters.required,
        properties: tool.parameters.properties,
      },
    },
  };
}

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
        convertMcpToolToContinueTool(
          tool,
          serverName,
          uniqueToolName(mcpToolName(serverName, tool.name), taken),
        ),
      );
    }
  }
  return tools;
}

export function convertMcpToolToContinueTool(
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

export async function executeToolCall(
  toolCall: PreprocessedToolCall,
  options: { parallelToolCallCount: number } = { parallelToolCallCount: 1 },
): Promise<string> {
  const startTime = Date.now();

  try {
    logger.debug("Executing tool", {
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      parallelToolCallCount: options.parallelToolCallCount,
    });

    // Track edits if Git AI is enabled (no-op if not enabled)
    await services.gitAiIntegration.trackToolUse(toolCall, "PreToolUse");

    const context: ToolRunContext = {
      toolCallId: toolCall.id,
      parallelToolCallCount: options.parallelToolCallCount,
    };

    // IMPORTANT: if preprocessed args are present, uses preprocessed args instead of original args
    // Preprocessed arg names may be different
    const result = await toolCall.tool.run(
      toolCall.preprocessResult?.args ?? toolCall.arguments,
      context,
    );
    const duration = Date.now() - startTime;

    // Track edits if Git AI is enabled (no-op if not enabled)
    await services.gitAiIntegration.trackToolUse(toolCall, "PostToolUse");

    telemetryService.logToolResult({
      toolName: toolCall.name,
      success: true,
      durationMs: duration,
      toolParameters: JSON.stringify(toolCall.arguments),
    });
    logger.debug("Tool execution completed", {
      toolName: toolCall.name,
      resultLength: result?.length || 0,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorReason =
      error instanceof ContinueError
        ? error.reason
        : ContinueErrorReason.Unknown;

    telemetryService.logToolResult({
      toolName: toolCall.name,
      success: false,
      durationMs: duration,
      error: errorMessage,
      errorReason,
      toolParameters: JSON.stringify(toolCall.arguments),
    });
    throw error;
  }
}

// The reader lives in validateArgs.ts so the depth of a schema is checked there
// and not here, where the tool list is assembled.
export { validateToolCallArgs } from "./validateArgs.js";
