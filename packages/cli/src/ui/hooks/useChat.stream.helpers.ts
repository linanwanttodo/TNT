import type { ChatHistoryItem, ToolCallState, ToolStatus } from "core/index.js";

import { ALL_BUILT_IN_TOOLS } from "src/tools/allBuiltIns.js";
import { logger } from "src/utils/logger.js";

import { services } from "../../services/index.js";
import { getCurrentSession, updateSessionTitle } from "../../session/index.js";

import { generateSessionTitle } from "./useChat.helpers.js";

interface CreateStreamCallbacksOptions {
  setChatHistory: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setActivePermissionRequest: React.Dispatch<React.SetStateAction<any>>;
  llmApi?: any;
  model?: any;
  /** Receives the final assistant text of each turn, for Stop hooks. */
  onAssistantText?: (text: string) => void;
  /**
   * Receives the in-progress answer (null when the turn's text completes).
   * Chunks never touch the history: every write there persists the session,
   * so the TUI renders the live text from this overlay instead.
   */
  onStreamingText?: (text: string | null) => void;
  /**
   * Receives the in-progress reasoning (null when the round's reasoning
   * completes). The reasoning is only attached to the history item once the
   * round ends, so without this overlay it would appear all at once.
   */
  onStreamingReasoning?: (text: string | null) => void;
}

/** The live answer re-renders at most this often. */
export const STREAM_RENDER_INTERVAL_MS = 60;

/**
 * Create stream callbacks for chat response
 */
export function createStreamCallbacks(
  options: CreateStreamCallbacksOptions,
): any {
  const {
    setChatHistory,
    setActivePermissionRequest,
    llmApi,
    model,
    onAssistantText,
    onStreamingText,
    onStreamingReasoning,
  } = options;

  let pendingStreamText: string | null = null;
  let streamFlushTimer: NodeJS.Timeout | null = null;
  const flushStreamText = () => {
    streamFlushTimer = null;
    onStreamingText?.(pendingStreamText);
  };
  const clearStreamOverlay = () => {
    pendingStreamText = null;
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
    onStreamingText?.(null);
  };

  let pendingReasoning: string | null = null;
  let reasoningFlushTimer: NodeJS.Timeout | null = null;
  const flushReasoning = () => {
    reasoningFlushTimer = null;
    onStreamingReasoning?.(pendingReasoning);
  };
  const clearReasoningOverlay = () => {
    pendingReasoning = null;
    if (reasoningFlushTimer) {
      clearTimeout(reasoningFlushTimer);
      reasoningFlushTimer = null;
    }
    onStreamingReasoning?.(null);
  };

  return {
    onContent: (text: string) => {
      if (!onStreamingText) return;
      // The stream reports deltas, so the overlay accumulates them the same
      // way streamChatResponse accumulates its final response.
      pendingStreamText = (pendingStreamText ?? "") + text;
      if (!streamFlushTimer) {
        streamFlushTimer = setTimeout(
          flushStreamText,
          STREAM_RENDER_INTERVAL_MS,
        );
      }
    },

    onReasoning: (text: string) => {
      if (!onStreamingReasoning) return;
      pendingReasoning = (pendingReasoning ?? "") + text;
      if (!reasoningFlushTimer) {
        reasoningFlushTimer = setTimeout(
          flushReasoning,
          STREAM_RENDER_INTERVAL_MS,
        );
      }
    },

    // Fires for every round, including one that only called tools and so has
    // no content for onContentComplete to report.
    onReasoningComplete: clearReasoningOverlay,

    onContentComplete: async (content: string) => {
      clearStreamOverlay();
      clearReasoningOverlay();
      if (content) {
        onAssistantText?.(content);
      }
      // Do not add assistant messages via service; handleToolCalls is the single writer
      // For environments where the service isn't ready (unit tests), update local state only
      try {
        const svc = services.chatHistory;
        const useService = typeof svc?.isReady === "function" && svc.isReady();
        if (!useService && content) {
          setChatHistory((prev) => [
            ...prev,
            {
              contextItems: [],
              message: {
                role: "assistant",
                content: content,
                isStreaming: false,
              },
            },
          ]);
        }
      } catch (error) {
        logger.error("Failed to update chat history", { error });
      }
      // Generate session title after first assistant response
      if (content && llmApi && model) {
        const currentSession = getCurrentSession();
        const generatedTitle = await generateSessionTitle(
          content,
          llmApi,
          model,
          currentSession.title,
        );

        if (generatedTitle) {
          updateSessionTitle(generatedTitle);
        }
      }
    },

    onToolStart: (toolName: string, toolArgs?: any) => {
      // TODO service should always be ready, get rid of this code. If it's not ready throw error

      // When ChatHistoryService is ready, let handleToolCalls add entries
      const svc = services.chatHistory;
      const useService = typeof svc?.isReady === "function" && svc.isReady();
      if (useService) return;

      // Fallback (service not ready): create a local assistant message representing the tool call
      setChatHistory((prev) => {
        const newHistory = [...prev];

        const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        const toolCallState: ToolCallState = {
          toolCallId: toolCallId,
          toolCall: {
            id: toolCallId,
            type: "function",
            function: {
              name: toolName,
              arguments: JSON.stringify(toolArgs || {}),
            },
          },
          status: "calling",
          parsedArgs: toolArgs,
        };

        newHistory.push({
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: toolCallId,
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify(toolArgs || {}),
                },
              },
            ],
          },
          contextItems: [],
          toolCallStates: [toolCallState],
        });

        return newHistory;
      });
    },

    onToolResult: (result: string, toolName: string, status: ToolStatus) => {
      // When service is ready, it updates tool results; avoid duplicate local updates
      const svc = services.chatHistory;
      const useService = typeof svc?.isReady === "function" && svc.isReady();
      if (useService) return;

      // Fallback (service not ready): update local UI-only state
      setChatHistory((prev) => {
        const newHistory = [...prev];

        for (let i = newHistory.length - 1; i >= 0; i--) {
          const item = newHistory[i];
          if (item.toolCallStates) {
            const toolState = item.toolCallStates.find(
              (ts) =>
                ts.toolCall.function.name === toolName &&
                (ts.status === "calling" || ts.status === "generated"),
            );

            if (toolState) {
              toolState.status = status;
              toolState.output = [
                {
                  content: result,
                  name: `Tool Result: ${toolName}`,
                  description: "Tool execution result",
                },
              ];
              break;
            }
          }
        }

        return newHistory;
      });
    },

    onToolError: (error: string, toolName?: string) => {
      // When service is ready, handleToolCalls adds error entries; avoid duplicate local updates
      const svc = services.chatHistory;
      const useService = typeof svc?.isReady === "function" && svc.isReady();
      if (useService) return;

      setChatHistory((prev) => {
        const newHistory = [...prev];

        if (toolName) {
          for (let i = newHistory.length - 1; i >= 0; i--) {
            const item = newHistory[i];
            if (item.toolCallStates) {
              const toolState = item.toolCallStates.find(
                (ts) =>
                  ts.toolCall.function.name === toolName &&
                  (ts.status === "calling" || ts.status === "generated"),
              );

              if (toolState) {
                toolState.status = "errored";
                toolState.output = [
                  {
                    content: error,
                    name: `Tool Error: ${toolName}`,
                    description: "Tool execution error",
                  },
                ];
                break;
              }
            }
          }
        } else {
          // General error message
          newHistory.push({
            message: {
              role: "system",
              content: error,
            },
            contextItems: [],
          });
        }

        return newHistory;
      });
    },

    onToolPermissionRequest: (
      toolName: string,
      toolArgs: any,
      requestId: string,
      toolCallPreview?: any[],
    ) => {
      // Check if this tool has dynamic evaluation
      const tool = ALL_BUILT_IN_TOOLS.find((t: any) => t.name === toolName);
      const hasDynamicEvaluation = !!tool?.evaluateToolCallPolicy;

      setActivePermissionRequest({
        toolName,
        toolArgs,
        requestId,
        toolCallPreview,
        hasDynamicEvaluation,
      });
    },

    onSystemMessage: (message: string) => {
      try {
        const svc = services.chatHistory;
        if (typeof svc?.isReady === "function" && svc.isReady()) {
          svc.addSystemMessage(message);
          return;
        }
      } catch {}
      // Fallback to local state if service unavailable
      setChatHistory((prev) => [
        ...prev,
        {
          message: {
            role: "system",
            content: message,
          },
          contextItems: [],
        },
      ]);
    },

    // A turn cut short by the step ceiling or a stalled loop still returns
    // its partial text, so the session needs to record that the text is not a
    // finished answer. Reuses the system-message channel rather than adding a
    // second way to surface notices.
    onTurnTerminated: (_reason: unknown, detail?: { notice?: string }) => {
      const notice = detail?.notice;
      if (!notice) {
        return;
      }
      try {
        const svc = services.chatHistory;
        if (typeof svc?.isReady === "function" && svc.isReady()) {
          svc.addSystemMessage(notice);
          return;
        }
      } catch {}
      setChatHistory((prev) => [
        ...prev,
        {
          message: {
            role: "system",
            content: notice,
          },
          contextItems: [],
        },
      ]);
    },
  };
}

interface ExecuteStreamingOptions {
  chatHistory: ChatHistoryItem[];
  model: any;
  llmApi: any;
  controller: AbortController;
  streamCallbacks: any;
  currentCompactionIndex: number | null;
  /** Model rounds allowed for this turn; unset means no round ceiling. */
  maxSteps?: number;
}

/**
 * Execute streaming chat response
 */
export async function executeStreaming({
  chatHistory,
  model,
  llmApi,
  controller,
  streamCallbacks,
  currentCompactionIndex,
  maxSteps,
}: ExecuteStreamingOptions): Promise<void> {
  const { getHistoryForLLM } = await import("../../compaction/index.js");
  const { runAgentTurn } = await import("../../session/controller.js");
  const turnBudgetLimits = maxSteps === undefined ? undefined : { maxSteps };

  if (model && llmApi) {
    if (
      currentCompactionIndex !== null &&
      currentCompactionIndex !== undefined
    ) {
      const historyForLLM = getHistoryForLLM(
        chatHistory,
        currentCompactionIndex,
      );

      await runAgentTurn({
        chatHistory: historyForLLM,
        model,
        llmApi,
        abortController: controller,
        callbacks: streamCallbacks,
        turnBudgetLimits,
      });

      // Service-driven streaming; history updates occur via ChatHistoryService
    } else {
      await runAgentTurn({
        chatHistory,
        model,
        llmApi,
        abortController: controller,
        callbacks: streamCallbacks,
        turnBudgetLimits,
      });
    }
  }
}
