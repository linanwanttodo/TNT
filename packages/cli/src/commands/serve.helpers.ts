import type { ChatHistoryItem, Session, ToolStatus } from "core/index.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
import { describeChangedFiles } from "../agent/changedFiles.js";
import {
  fireSessionEnd,
  fireSessionStart,
  fireStop,
  fireUserPromptSubmit,
  takeSessionStartContext,
} from "../hooks/fireHook.js";
import type { TurnBudgetLimits } from "../loop/turnBudget.js";
import { services } from "../services/index.js";
import { updateSessionTitle } from "../session/index.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";
import { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { logger } from "../utils/logger.js";

/**
 * Remove partial assistant message if the last message is an empty assistant message.
 * Used when a response is interrupted.
 */
export function removePartialAssistantMessage(
  sessionHistory: ChatHistoryItem[],
): void {
  try {
    const svcHistory = services.chatHistory.getHistory();
    const last = svcHistory[svcHistory.length - 1];
    if (last && last.message.role === "assistant" && !last.message.content) {
      services.chatHistory.setHistory(svcHistory.slice(0, -1));
    }
  } catch {
    const lastMessage = sessionHistory[sessionHistory.length - 1];
    if (
      lastMessage &&
      lastMessage.message.role === "assistant" &&
      !lastMessage.message.content
    ) {
      sessionHistory.pop();
    }
  }
}

/**
 * Announce a served session. The server hosts one session for its whole life, so
 * SessionStart and SessionEnd belong to the process, not to a request: without
 * them a hooks.json written for the reference sees tool calls but no session in
 * a `tnt serve` deployment, which is the mode the web client uses.
 */
export async function startServedSession(
  resumed: boolean,
  model?: string,
): Promise<void> {
  await fireSessionStart(resumed ? "resume" : "startup", model).catch(() => {});
}

export async function endServedSession(
  reason: "clear" | "logout" | "prompt_input_exit" | "other",
): Promise<void> {
  await fireSessionEnd(reason).catch(() => {});
}

/**
 * The prompt as the model should see it: a UserPromptSubmit hook may block the
 * turn or add context to it, and the note a SessionStart hook wrote for the
 * session leads on the first prompt only.
 */
export async function prepareServedPrompt(message: string): Promise<{
  text: string;
  blocked: boolean;
  blockReason?: string;
}> {
  const promptHook = await fireUserPromptSubmit(message).catch(() => null);
  if (promptHook?.blocked) {
    return {
      text: message,
      blocked: true,
      blockReason: promptHook.blockReason,
    };
  }
  const notes = [
    takeSessionStartContext(),
    promptHook?.additionalContext,
    describeChangedFiles(),
  ]
    .filter((note): note is string => Boolean(note))
    .join("\n\n");
  return { text: notes ? `${notes}\n\n${message}` : message, blocked: false };
}

/** A served turn that produced an answer is a Stop; an interrupted one is not. */
export async function finishServedTurn(
  lastAssistantMessage: string,
): Promise<void> {
  await fireStop(lastAssistantMessage).catch(() => {});
}

/**
 * Run one served turn. Interruption belongs to the abort controller: `POST
 * /pause` and `POST /exit` abort it, and the engine stops on the signal. What
 * used to sit here was a 100ms poll of a callback the caller passed as
 * `() => false`, so it could only ever add a timer to every response.
 */
export async function streamServeResponse(
  state: ServerState,
  llmApi: any,
  abortController: AbortController,
  turnBudgetLimits?: Partial<TurnBudgetLimits>,
): Promise<string> {
  // Create callbacks to capture tool events
  const callbacks: StreamCallbacks = {
    onContent: (_: string) => {
      // onContent is empty - doesn't update history during streaming
      // This is just for real-time display purposes
    },
    onContentComplete: (_: string) => {
      // Note: streamChatResponse already adds messages to history via handleToolCalls
      // so we don't need to add them here - this callback is just for notification
      // that content streaming is complete
    },
    onToolStart: (__: string, _?: any) => {
      // Note: handleToolCalls already adds the tool call message to history
      // This callback is just for notification/UI updates
      // The tool call state is already created and added by handleToolCalls
    },
    onToolResult: (_result: string, _toolName: string, _status: ToolStatus) => {
      // No-op when using ChatHistoryService; it updates tool states/results
    },
    onToolError: (_error: string, _toolName?: string) => {
      // No-op; errors are added to history via handleToolCalls flow
    },
    onToolPermissionRequest: (
      toolName: string,
      toolArgs: any,
      requestId: string,
      toolCallPreview?: any[],
    ) => {
      // Set pending permission state
      state.pendingPermission = {
        toolName,
        toolArgs,
        requestId,
        timestamp: Date.now(),
        toolCallPreview,
      };

      // Add a system message indicating permission is needed via service
      try {
        services.chatHistory.addSystemMessage(
          `WARNING: Tool ${toolName} requires permission`,
        );
      } catch (err) {
        // Do not mutate session history; ChatHistoryService is the source of truth
        logger.error(
          "Failed to add system message via ChatHistoryService",
          err,
          { context: "onToolPermissionRequest", toolName, requestId },
        );
      }

      // Don't wait here - the streamChatResponse will handle waiting
    },
    onSystemMessage: (message: string) => {
      try {
        services.chatHistory.addSystemMessage(message);
      } catch (err) {
        // Do not mutate session history; ChatHistoryService is the source of truth
        logger.error(
          "Failed to add system message via ChatHistoryService",
          err,
          { context: "onSystemMessage" },
        );
      }
    },
  };

  // The session history keeps the system prompt at its head for the /state
  // snapshot, but the request header re-injects the same prompt (the same
  // constructSystemMessage inputs), so a leading system item would be sent
  // twice. The stream gets the history without it.
  const history =
    state.session.history[0]?.message?.role === "system"
      ? state.session.history.slice(1)
      : state.session.history;

  const response = await streamChatResponse(
    history,
    state.model,
    llmApi,
    abortController,
    callbacks,
    false,
    turnBudgetLimits,
  );
  return response || "";
}

export interface PendingPermission {
  toolName: string;
  toolArgs: any;
  requestId: string;
  timestamp: number;
  toolCallPreview?: any[];
}

/**
 * Name an untitled session from the first assistant response, matching the
 * TUI and headless surfaces; a title set earlier is kept. A failure here must
 * never fail the served turn.
 */
export async function titleServeSessionIfUntitled(
  session: Session,
  response: string,
  llmApi: any,
  model: any,
): Promise<string | undefined> {
  try {
    if (session.title !== DEFAULT_SESSION_TITLE) {
      return undefined;
    }
    if (!response || !response.trim()) {
      return undefined;
    }
    const { ChatDescriber } = await import("core/util/chatDescriber.js");
    const generated = await ChatDescriber.describeWithBaseLlmApi(
      llmApi,
      model,
      response,
    );
    if (generated) {
      updateSessionTitle(generated);
    }
    return generated;
  } catch (error) {
    logger.debug("Serve session title generation failed:", error as Error);
    return undefined;
  }
}

export interface ServerState {
  session: Session;
  config: any;
  model: any;
  isProcessing: boolean;
  lastActivity: number;
  currentAbortController: AbortController | null;
  serverRunning: boolean;
  pendingPermission: PendingPermission | null;
  systemMessage?: string;
}

/**
 * Check if the agent should be marked as complete based on conversation history.
 * The agent is complete if the last message is from the assistant and has no tool calls.
 */
export function checkAgentComplete(
  history: { message: { role: string; tool_calls?: any[] } }[] | undefined,
): boolean {
  if (!history || history.length === 0) {
    return false;
  }
  const lastItem = history[history.length - 1];
  if (lastItem?.message?.role !== "assistant") {
    return false;
  }
  const toolCalls = (lastItem.message as any).tool_calls;
  return !toolCalls || toolCalls.length === 0;
}
