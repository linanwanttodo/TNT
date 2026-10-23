// @ts-ignore
import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { ChatCompletionTool } from "openai/resources.mjs";

import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { logger } from "../utils/logger.js";

import type {
  PreprocessedToolCall,
  Tool,
  ToolCall,
  ToolParametersSchema,
  ToolRunContext,
} from "./types.js";

export type { Tool, ToolCall, ToolParametersSchema };

/**
 * The tool layer's public surface.
 *
 * The parts live beside this file by responsibility: `registry.ts` composes
 * which tools exist, `selection/` decides which of them one request advertises,
 * `mcp.ts` owns MCP naming and translation, and this module parses calls,
 * converts schemas, and executes a preprocessed call. They are re-exported here
 * because most callers only need "the tools module".
 */
export { getAllAvailableTools, getToolDisplayName } from "./registry.js";
export {
  MCP_TOOL_NAME_LIMIT,
  mcpToolName,
  mcpToolsFromConnections,
  convertMcpToolToContinueTool,
} from "./mcp.js";

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
