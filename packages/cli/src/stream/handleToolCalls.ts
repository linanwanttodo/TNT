import type { ChatHistoryItem, ToolStatus } from "core/index.js";
import { stripImages } from "core/util/messageContent.js";
import { createHistoryItem } from "core/util/messageConversion.js";

import type { ToolPermissions } from "src/permissions/types.js";

import { services } from "../services/index.js";
import { ToolCall } from "../tools/index.js";
import { logger } from "../utils/logger.js";
import { completedReasoning } from "../utils/reasoning.js";

import {
  executeStreamedToolCalls,
  preprocessStreamedToolCalls,
} from "./streamChatResponse.helpers.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";

// The selection policy lives with the tool layer; exported here because the
// stream engine and its mocks already import it through this module.
export { getRequestTools } from "../tools/selection/requestTools.js";

interface HandleToolCallsOptions {
  toolCalls: ToolCall[];
  chatHistory: ChatHistoryItem[];
  content: string;
  callbacks: StreamCallbacks | undefined;
  isHeadless: boolean;
  usage?: any;
  /**
   * The provider's reasoning channel for this round. It is stored beside the
   * assistant message so the transcript can show the thought; it is never
   * appended to the answer text.
   */
  reasoning?: string;
  /**
   * Forwarded to the executor so the caller can keep a per-tool failure tally.
   * A permission denial is not a tool failure, so it is deliberately not
   * reported here.
   */
  onToolOutcome?: (
    toolName: string,
    succeeded: boolean,
    error?: unknown,
  ) => void;
  /**
   * Permissions to enforce. Left unset, the process-wide policy is used.
   */
  permissions?: ToolPermissions;
  /** Model context forwarded to the auto-mode classifier. */
  llmApi?: any;
  model?: any;
  /**
   * Whether this run may delegate again. False at the depth limit.
   */
  canDelegate?: boolean;
}

export async function handleToolCalls(
  options: HandleToolCallsOptions,
): Promise<boolean> {
  const {
    toolCalls,
    chatHistory,
    content,
    callbacks,
    isHeadless,
    usage,
    reasoning,
  } = options;
  const chatHistorySvc = services.chatHistory;
  const useService =
    typeof chatHistorySvc?.isReady === "function" && chatHistorySvc.isReady();
  if (toolCalls.length === 0) {
    if (content || reasoning) {
      if (useService) {
        // Service-driven: write assistant message via service
        chatHistorySvc.addAssistantMessage(
          content,
          undefined,
          usage,
          reasoning,
        );
      } else {
        // Fallback only when service is unavailable
        const message: any = {
          role: "assistant",
          content,
        };
        if (usage) {
          message.usage = usage;
        }
        const item = createHistoryItem(message);
        if (reasoning?.trim()) {
          item.reasoning = completedReasoning(reasoning);
        }
        chatHistory.push(item);
      }
    }
    return false;
  }

  // Create tool call states for the ChatHistoryItem
  const toolCallStates = toolCalls.map((tc) => ({
    toolCallId: tc.id,
    toolCall: {
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    },
    status: "generated" as ToolStatus,
    parsedArgs: tc.arguments,
  }));

  // Create assistant message with tool calls
  const assistantMessage = {
    role: "assistant" as const,
    content: content || "",
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
      ...(tc.extra_content && { extra_content: tc.extra_content }),
    })),
  };

  if (useService) {
    // Important: pass ChatCompletion-style toolCalls, not internal ToolCall[]
    chatHistorySvc.addAssistantMessage(
      assistantMessage.content || "",
      assistantMessage.toolCalls,
      usage,
      reasoning,
    );
  } else {
    // Fallback only when service is unavailable
    const messageWithUsage = usage
      ? { ...assistantMessage, usage }
      : assistantMessage;
    const item = createHistoryItem(messageWithUsage, [], toolCallStates);
    if (reasoning?.trim()) {
      item.reasoning = completedReasoning(reasoning);
    }
    chatHistory.push(item);
  }

  // First preprocess the tool calls
  const { preprocessedCalls, errorChatEntries } =
    await preprocessStreamedToolCalls(
      isHeadless,
      toolCalls,
      callbacks,
      options.canDelegate,
    );

  // Add any preprocessing errors to the toolCallStates on the assistant message
  // (NOT as separate history items, which would cause duplicate tool_result messages)
  errorChatEntries.forEach((errorEntry) => {
    const errorContent = stripImages(errorEntry.content) || "";
    if (useService) {
      chatHistorySvc.addToolResult(
        errorEntry.tool_call_id,
        errorContent,
        "errored",
      );
    } else {
      // Fallback only when service is unavailable: update local tool state
      const lastAssistantIndex = chatHistory.findLastIndex(
        (item) => item.message.role === "assistant" && item.toolCallStates,
      );
      if (
        lastAssistantIndex >= 0 &&
        chatHistory[lastAssistantIndex].toolCallStates
      ) {
        const toolState = chatHistory[lastAssistantIndex].toolCallStates.find(
          (ts) => ts.toolCallId === errorEntry.tool_call_id,
        );
        if (toolState) {
          toolState.status = "errored";
          toolState.output = [
            {
              content: errorContent,
              name: `Tool Result`,
              description: "Tool execution result",
            },
          ];
        }
      }
    }
  });

  // Execute the valid preprocessed tool calls
  // Note: executeStreamedToolCalls adds tool results to toolCallStates via
  // services.chatHistory.addToolResult() internally
  const { hasRejection } = await executeStreamedToolCalls(
    preprocessedCalls,
    callbacks,
    isHeadless,
    options.onToolOutcome,
    {
      permissions: options.permissions,
      autoContext: {
        llmApi: options.llmApi,
        model: options.model,
        history: chatHistory,
      },
    },
  );

  if (isHeadless && hasRejection) {
    logger.debug(
      "Tool call rejected in headless mode - returning current content",
    );
    return true; // Signal early return needed
  }

  // Tool results are already added to toolCallStates in executeStreamedToolCalls
  // via services.chatHistory.addToolResult() - no need to add them again here.
  // Adding them again would be redundant (and previously caused duplicate tool_result messages
  // when combined with separate tool history items).
  return false;
}
