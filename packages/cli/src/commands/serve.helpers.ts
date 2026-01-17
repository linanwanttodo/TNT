import chalk from "chalk";
import type { ChatHistoryItem, Session, ToolStatus } from "core/index.js";
import type { Express, NextFunction, Request, Response } from "express";

import { describeChangedFiles } from "../agent/changedFiles.js";
import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
import {
  fireSessionEnd,
  fireSessionStart,
  fireStop,
  fireUserPromptSubmit,
  takeSessionStartContext,
} from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import type { TurnBudgetLimits } from "../loop/turnBudget.js";
import { subscribeAgentEvents } from "../protocol/eventBus.js";
import { services } from "../services/index.js";
import { runAgentTurn } from "../session/controller.js";
import { updateSessionTitle } from "../session/index.js";
import { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { formatError } from "../utils/formatError.js";
import { getGitDiffSnapshot } from "../utils/git.js";
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

  const response = await runAgentTurn({
    chatHistory: history,
    model: state.model,
    llmApi,
    abortController,
    callbacks,
    turnBudgetLimits,
  });
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
 * Guards the unauthenticated HTTP surface against browser-originated
 * requests. A page the user is reading can reach a loopback server, so the
 * guard closes both routes in:
 *
 * - DNS rebinding, by rejecting any Host header that is not one of the
 *   loopback hosts on the served port (a rebound page sends its own domain).
 *   Relaxed when the operator bound a non-loopback interface with `--host`,
 *   since that exposure was chosen explicitly.
 * - cross-site writes, by rejecting requests that carry an Origin header
 *   other than a loopback origin. Browsers attach Origin on cross-origin
 *   POSTs; command-line clients typically send none and are unaffected.
 */
export function attachBrowserOriginGuard(
  app: Express,
  port: number,
  boundHost?: string,
): void {
  const loopbackHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  const loopback =
    !boundHost ||
    ["127.0.0.1", "localhost", "::1"].includes(boundHost.toLowerCase());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      const originHost = origin.replace(/^https?:\/\//i, "").toLowerCase();
      if (!loopbackHosts.has(originHost)) {
        return res
          .status(403)
          .json({ error: "Cross-origin requests are not accepted" });
      }
    }

    if (loopback) {
      const host = (req.headers.host || "").toString().toLowerCase();
      if (host.length > 0 && !loopbackHosts.has(host)) {
        return res
          .status(403)
          .json({ error: "Host header does not match the loopback server" });
      }
    }

    next();
  });
}

/**
 * GET /events - Stream the engine event contract as server-sent events.
 * The polling /state endpoint stays for the current remote client; a client
 * that understands events gets reasoning, tool lifecycle, and approvals
 * without waiting for the next snapshot.
 */
export function registerSseEventRoute(
  app: Express,
  state: ServerState,
): void {
  app.get("/events", (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = subscribeAgentEvents((event) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}

/**
 * GET /diff - Return git diff against main branch.
 */
export function registerDiffRoute(app: Express, state: ServerState): void {
  app.get("/diff", async (_req: Request, res: Response) => {
    state.lastActivity = Date.now();

    try {
      const diffResult = await getGitDiffSnapshot();

      if (!diffResult.repoFound) {
        res.status(404).json({
          error: "Not in a git repository or main branch doesn't exist",
          diff: "",
        });
        return;
      }

      res.json({
        diff: diffResult.diff,
      });
    } catch (error) {
      logger.error(`Git diff error: ${formatError(error)}`);
      res.status(500).json({
        error: `Failed to get git diff: ${formatError(error)}`,
        diff: "",
      });
    }
  });
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

/**
 * A failed bind is otherwise an unhandled 'error' event: Node exits without a word
 * and a caller reads exit 0 as "the server started". This names the address and the
 * reason, and exits 1 so a script can tell the difference.
 */
export function attachBindErrorHandler(
  server: { on(event: "error", handler: (error: Error) => void): unknown },
  host: string,
  port: number,
): void {
  server.on("error", (error) => {
    console.error(
      chalk.red(
        t("serve.bindFailed", { host, port, message: formatError(error) }),
      ),
    );
    process.exit(1);
  });
}
