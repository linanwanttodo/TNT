/* eslint-disable max-lines */
/* eslint-disable max-statements   */
import type { ChatHistoryItem, Session } from "core/index.js";
import { useApp } from "ink";
import { useEffect, useRef, useState } from "react";

import { describeChangedFiles } from "../../agent/changedFiles.js";
import { currentPromptCacheKey } from "../../cache/promptCacheKey.js";
import { describeContextBudget } from "../../compaction/contextBudget.js";
import { findCompactionIndex } from "../../compaction/index.js";
import {
  fireSessionEnd,
  fireSessionStart,
  fireStop,
  fireUserPromptSubmit,
  takeSessionStartContext,
} from "../../hooks/fireHook.js";
import { t } from "../../i18n/index.js";
import { interactionBroker } from "../../permissions/interactionBroker.js";
import { services } from "../../services/index.js";
import type { QuizItemAnswer } from "../../services/QuizService.js";
import { turnRunnerService } from "../../services/TurnRunnerService.js";
import {
  createSession,
  resumeSession,
  takeSessionLeaseConflict,
  updateSessionHistory,
} from "../../session/index.js";
import { generatePromptSuggestion } from "../../session/promptSuggestionGenerator.js";
import { messageQueue, QueuedMessage } from "../../stream/messageQueue.js";
import { clearSeriesSectionBaselines } from "../../stream/systemPromptSeries.js";
import { beginTurnUsage, endTurnUsage } from "../../stream/usageTelemetry.js";
import { telemetryService } from "../../telemetry/telemetryService.js";
import { formatError } from "../../utils/formatError.js";
import { logger } from "../../utils/logger.js";
import { composeServedPrompt } from "../../utils/promptNotes.js";
import { liveHub } from "../../webuiZcode/liveHub.js";
import { handleSlashCommands } from "../commands/index.js";
import { requestComposerDraft } from "../composerDraft.js";
import { notifyTurnComplete } from "../notify.js";

import {
  handleAutoCompaction,
  handleCompactCommand,
} from "./useChat.compaction.js";
import {
  formatMessageWithFiles,
  handleSpecialCommands,
  initChatHistory,
  processSlashCommandResult,
  trackUserMessage,
} from "./useChat.helpers.js";
import {
  handleRemoteMessage,
  setupRemotePolling,
} from "./useChat.remote.helpers.js";
import { handleBashModeProcessing } from "./useChat.shellMode.js";
import {
  createStreamCallbacks,
  executeStreaming,
} from "./useChat.stream.helpers.js";
import {
  ActivePermissionRequest,
  ActiveQuizQuestion,
  AttachedFile,
  UseChatProps,
} from "./useChat.types.js";

/**
 * One queued message as delivered by the shared drain loop. The render
 * settle stays here so the TUI paints the dequeue before the next turn
 * starts; a signal aborted before entry means the turn was stopped.
 */
export const runOneTurn = async (
  queued: QueuedMessage,
  signal: AbortSignal,
  processQueuedMessage: (
    message: string,
    imageMap?: Map<string, Buffer>,
  ) => Promise<void>,
): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  logger.debug("processing queued message", { queued: queued.message });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await processQueuedMessage(queued.message, queued.imageMap);
};

/**
 * Bridges stop requests from other surfaces to the TUI's interrupt path. The
 * hook registers `handleInterrupt` through this so a web stop button truncates
 * the in-flight turn the same way Esc does; the ref indirection keeps the
 * handler reading current hook state, not the mount-time closure.
 */
export const registerStopRequestListener = (
  getHandleInterrupt: () => () => void,
): (() => void) => {
  return turnRunnerService.onStopRequest(() => getHandleInterrupt()());
};

export function useChat({
  assistant,
  model,
  llmApi,
  initialPrompt,
  resume,
  sessionId,
  fork,
  maxSteps,
  additionalRules,
  additionalPrompts,
  onShowModelSelector,
  onShowUpdateSelector,
  onShowThemeSelector,
  onShowMCPSelector,
  onShowMcpMarketplace,
  onShowSessionSelector,
  onShowSubagentsSelector,
  onLoadSession,
  onShowJobsSelector,
  onShowExportSelector,
  onClear,
  onRefreshStatic,
  isRemoteMode = false,
  remoteUrl,
  isReadOnlySession = false,
  onShowDiff,
  onShowStatusMessage,
}: UseChatProps) {
  const { exit } = useApp();

  // Track service subscription
  const serviceListenerCleanupRef = useRef<null | (() => void)>(null);
  const lastAssistantTextRef = useRef<string | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  // The state setter lags a frame behind; the command gate needs the truth
  // the moment a mid-turn slash command submits.
  const turnRunningRef = useRef(false);

  // Store the current session
  const [currentSession, setCurrentSession] = useState<Session>(() => {
    // In remote mode, start with empty session (will be populated by polling)
    if (isRemoteMode) {
      return createSession([]);
    }

    // Fork from an existing session if fork flag is used
    if (fork) {
      const {
        loadSessionById,
        startNewSession,
      } = require("../../session/index.js");
      const sessionToFork = loadSessionById(fork);
      if (sessionToFork) {
        return startNewSession(sessionToFork.history);
      }
      // If session not found, create a new empty session
      return createSession([]);
    }

    // Load previous session if resume flag is used
    if (resume) {
      const savedSession = resumeSession(sessionId);
      if (savedSession) {
        return savedSession;
      }
      // A null resume with a recorded conflict means another window owns that
      // transcript. Starting a fresh session is right; silently pretending the
      // resume worked is not, so the reason reaches the log.
      const conflict = takeSessionLeaseConflict();
      if (conflict) {
        logger.warn("Session is open in another TNT process", conflict);
      }
    }

    // Create new session
    return createSession([]);
  });

  // Local view of history driven solely by ChatHistoryService
  const [chatHistory, setChatHistoryView] = useState<ChatHistoryItem[]>(() =>
    services.chatHistory?.isReady()
      ? services.chatHistory.getHistory()
      : currentSession.history,
  );
  // Proxy setter: apply changes to ChatHistoryService (single source of truth)
  const setChatHistory: React.Dispatch<
    React.SetStateAction<ChatHistoryItem[]>
  > = (value) => {
    const svc = services.chatHistory;
    const current = svc.getHistory();
    const next = typeof value === "function" ? (value as any)(current) : value;
    svc.setHistory(next);
  };

  // Initialize ChatHistoryService and subscribe to updates
  useEffect(() => {
    const svc = services.chatHistory;
    svc
      .initialize(currentSession, isRemoteMode)
      .then(() => {
        setChatHistoryView(svc.getHistory());
        const listener = () => {
          setChatHistoryView(svc.getHistory());
        };
        svc.on("stateChanged", listener);
        serviceListenerCleanupRef.current = () =>
          svc.off("stateChanged", listener);
      })
      .catch((error) => {
        logger.error("Failed to initialize ChatHistoryService", { error });
      });

    return () => {
      serviceListenerCleanupRef.current?.();
      serviceListenerCleanupRef.current = null;
    };
  }, []);

  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  // The in-progress answer, rendered from this overlay instead of the history:
  // history writes persist the session, so per-chunk updates would hit disk.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(
    null,
  );
  const [responseStartTime, setResponseStartTime] = useState<number | null>(
    null,
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactionStartTime, setCompactionStartTime] = useState<number | null>(
    null,
  );
  const [inputMode, setInputMode] = useState(true);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [compactionAbortController, setCompactionAbortController] =
    useState<AbortController | null>(null);
  const [isChatHistoryInitialized, setIsChatHistoryInitialized] = useState(
    // If we're resuming and found a saved session, we're already initialized
    // If we're forking and found a session to fork from, we're already initialized
    // If we're in remote mode, we're initialized (will be populated by polling)
    isRemoteMode ||
      (resume && currentSession.history.length > 0) ||
      (fork && currentSession.history.length > 0),
  );

  // Capture initial rules to prevent re-initialization when rules change
  const [initialRules] = useState(additionalRules);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [activePermissionRequest, setActivePermissionRequest] =
    useState<ActivePermissionRequest | null>(null);
  const [activeQuizQuestion, setActiveQuizQuestion] =
    useState<ActiveQuizQuestion | null>(null);
  const [compactionIndex, setCompactionIndex] = useState<number | null>(() => {
    // When resuming or forking, check for compaction markers in the loaded history
    if ((resume || fork) && currentSession.history.length > 0) {
      return findCompactionIndex(currentSession.history);
    }
    return null;
  });

  // Track interrupted state for resume functionality
  const [wasInterrupted, setWasInterrupted] = useState(false);

  // Track queued messages for immediate display. The queue is the authority;
  // every event resyncs from a snapshot so a remove or edit cannot leave a
  // stale row.
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>(() => [
    ...messageQueue.getAllMessages(),
  ]);

  useEffect(() => {
    const sync = () => {
      setQueuedMessages([...messageQueue.getAllMessages()]);
    };

    messageQueue.on("messageQueued", sync);
    messageQueue.on("messageDequeued", sync);
    messageQueue.on("messageRemoved", sync);
    messageQueue.on("messageUpdated", sync);
    messageQueue.on("messageCleared", sync);
    sync();

    return () => {
      messageQueue.off("messageQueued", sync);
      messageQueue.off("messageDequeued", sync);
      messageQueue.off("messageRemoved", sync);
      messageQueue.off("messageUpdated", sync);
      messageQueue.off("messageCleared", sync);
    };
  }, []);

  // Set up quiz service listeners
  useEffect(() => {
    const quizSvc = services.quiz;

    const onQuestionRequested = (pending: ActiveQuizQuestion) => {
      setActiveQuizQuestion(pending);
    };

    const onQuestionAnswered = () => {
      setActiveQuizQuestion(null);
    };

    quizSvc.on("questionRequested", onQuestionRequested);
    quizSvc.on("questionAnswered", onQuestionAnswered);

    return () => {
      quizSvc.off("questionRequested", onQuestionRequested);
      quizSvc.off("questionAnswered", onQuestionAnswered);
    };
  }, []);

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
    };
  }, [abortController]);

  // Fire SessionStart once per session, then SessionEnd when the UI unmounts.
  useEffect(() => {
    const source: "startup" | "resume" = resume ? "resume" : "startup";
    fireSessionStart(source, model?.model).catch(() => {});
    return () => {
      fireSessionEnd("other").catch(() => {});
    };
  }, []);

  // Remote mode polling
  useEffect(() => {
    if (!isRemoteMode || !remoteUrl || process.env.NODE_ENV === "test") return;

    return setupRemotePolling({
      remoteUrl,
      setIsWaitingForResponse,
      responseStartTime,
      setResponseStartTime,
    });
  }, [isRemoteMode, remoteUrl, responseStartTime]);

  useEffect(() => {
    // Skip initialization in remote mode or if already initialized
    if (isRemoteMode || isChatHistoryInitialized) return;

    // Initialize chat history with system message only if we don't have a session
    const initializeHistory = async () => {
      // Only add system message if we don't have any messages yet
      if (chatHistory.length === 0) {
        const history = await initChatHistory(resume, initialRules);
        setChatHistory(history);
      }
      setIsChatHistoryInitialized(true);
    };

    void initializeHistory();
    // Note: Using initialRules instead of additionalRules to prevent re-initialization
    // when rules change during the conversation
  }, [
    isRemoteMode,
    isChatHistoryInitialized,
    chatHistory.length,
    resume,
    initialRules,
  ]);

  useEffect(() => {
    // Only handle initial prompt after chat history is initialized
    // This prevents race conditions where the prompt runs before system message is loaded
    if (
      (initialPrompt || (additionalPrompts && additionalPrompts.length > 0)) &&
      isChatHistoryInitialized
    ) {
      const processPrompts = async () => {
        const { processAndCombinePrompts } =
          await import("../../utils/promptProcessor.js");
        const finalMessage = await processAndCombinePrompts(
          additionalPrompts,
          initialPrompt,
        );

        if (finalMessage) {
          await handleUserMessage(finalMessage);
        }
      };

      processPrompts().catch(console.error);
    }
  }, [initialPrompt, additionalPrompts, isChatHistoryInitialized]);

  const executeStreamingResponse = async (
    newHistory: ChatHistoryItem[],
    currentCompactionIndex: number | null,
  ) => {
    // Clean up previous abort controller if it exists
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    // Start streaming response
    const controller = new AbortController();
    setAbortController(controller);
    setIsWaitingForResponse(true);
    turnRunningRef.current = true;
    // The per-round ledger restarts; the turn-end notice reads it once.
    beginTurnUsage();
    // The shared view learns the turn began and what it answers, the same
    // way the terminal shows the typed line (atomcode's input echo).
    liveHub.publishTurnStarted(lastUserMessageRef.current ?? "");
    setResponseStartTime(Date.now());
    setInputMode(false);
    logger.debug("Starting chat response stream", {
      historyLength: newHistory.length,
    });

    // Hoisted so the interruption record below can read what the reader was
    // watching when the round died.
    let streamCallbacks: any = null;
    try {
      const baseCallbacks = createStreamCallbacks({
        setChatHistory: setChatHistory,
        setActivePermissionRequest,
        llmApi,
        model,
        onAssistantText: (text: string) => {
          lastAssistantTextRef.current = text;
        },
        onStreamingText: setStreamingText,
        onStreamingReasoning: setStreamingReasoning,
      });
      // The shared view follows the same stream the terminal renders. The
      // base callbacks stay first so the screen never depends on the hub.
      streamCallbacks = {
        ...baseCallbacks,
        onContent: (content: string) => {
          baseCallbacks.onContent?.(content);
          liveHub.publishContent(content);
        },
        onReasoning: (delta: string) => {
          baseCallbacks.onReasoning?.(delta);
          liveHub.publishReasoning(delta);
        },
        onToolStart: (
          toolName: string,
          toolArgs?: unknown,
          toolCallId?: string,
        ) => {
          baseCallbacks.onToolStart?.(toolName, toolArgs, toolCallId);
          liveHub.publishToolStarted(toolName, toolArgs, toolCallId);
        },
        onToolResult: (
          result: string,
          toolName: string,
          status: any,
          toolCallId?: string,
        ) => {
          baseCallbacks.onToolResult?.(result, toolName, status, toolCallId);
          liveHub.publishToolFinished(toolName, status, result, toolCallId);
        },
        // A message typed while the tools run is delivered at the next round
        // boundary instead of waiting for the whole turn to finish: the
        // engine is about to issue another request, so the message rides it.
        onRoundBoundary: async () => {
          const pending = messageQueue.peekNextMessage();
          if (!pending) return false;
          // A slash command is a turn-level action (processMessage decides
          // what it means); running one inside a tool batch would race the
          // stream, so it stays queued for the drain loop.
          if (pending.message.trimStart().startsWith("/")) return false;

          try {
            const promptHook = await fireUserPromptSubmit(pending.message);
            if (promptHook.blocked) {
              onShowStatusMessage?.(
                promptHook.blockReason ?? "Blocked by UserPromptSubmit hook",
              );
              return false;
            }
            const served = composeServedPrompt(
              pending.message,
              promptHook.additionalContext
                ? [promptHook.additionalContext]
                : [],
            );
            const item = await formatMessageWithFiles(
              served,
              [],
              pending.imageMap,
              pending.message,
            );
            // Dequeue by id: another consumer may have taken the entry while
            // the hook or the formatter awaited, and appending it twice would
            // duplicate the user's message.
            if (!messageQueue.removeMessage(pending.id)) return false;
            services.chatHistory.addHistoryItem(item);
            setChatHistory(services.chatHistory.getHistory());
            lastUserMessageRef.current = pending.message;
            return true;
          } catch (error) {
            logger.error(
              "Could not deliver a queued message at the round boundary",
              { error },
            );
            return false;
          }
        },
      };

      // Execute streaming chat response
      await executeStreaming({
        chatHistory: newHistory,
        model,
        llmApi,
        controller,
        streamCallbacks,
        currentCompactionIndex,
        maxSteps,
      });

      // The shared view closes the turn with the same answer it streamed,
      // plus the ledger: what this turn read, wrote and cost.
      liveHub.publishTurnCompleted({
        content: streamCallbacks?.getAccumulated()?.text ?? "",
        usage: endTurnUsage() ?? undefined,
      });

      // Save the updated session with the latest chat history that includes the assistant's reply
      // The streamCallbacks update setChatHistory during streaming, so we need to get the current state
      setChatHistory((currentHistory) => {
        const updatedSession: Session = {
          ...currentSession,
          history: currentHistory,
        };
        updateSessionHistory(currentHistory);
        setCurrentSession(updatedSession);
        logger.debug("Session saved");
        return currentHistory;
      });
    } catch (error: any) {
      // An interrupted turn is not a failure. The partial answer and the
      // reasoning the reader was watching are their transcript: record them,
      // as in the reference CLI, so the next message continues from them
      // instead of the round vanishing. A failure additionally appends the
      // error notice.
      const accumulated = streamCallbacks?.getAccumulated() ?? {
        text: "",
        reasoning: "",
      };
      if (accumulated.text || accumulated.reasoning) {
        services.chatHistory.addAssistantMessage(
          accumulated.text,
          undefined,
          undefined,
          accumulated.reasoning || undefined,
        );
      }

      if (controller.signal.aborted) {
        liveHub.publishTurnCompleted({
          interrupted: true,
          usage: endTurnUsage() ?? undefined,
        });
        setWasInterrupted(true);
      } else {
        const errorMessage = `Error: ${formatError(error)}`;
        liveHub.publishTurnFailed(errorMessage);
        endTurnUsage();
        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content: errorMessage,
            },
            contextItems: [],
          },
        ]);
      }
    } finally {
      // Stop active time tracking
      if (typeof responseStartTime === "number") {
        notifyTurnComplete({
          elapsedMs: Date.now() - responseStartTime,
          text: t("notify.turnComplete"),
        });
      }
      telemetryService.stopActiveTime();
      fireStop(lastAssistantTextRef.current ?? undefined).catch(() => {});

      setAbortController(null);
      setIsWaitingForResponse(false);
      turnRunningRef.current = false;
      setResponseStartTime(null);
      setInputMode(true);
      setStreamingText(null);
      // A turn that ends on a stall or an abort never reaches the round's
      // completion callback, so the overlay is cleared here as well.
      setStreamingReasoning(null);

      // Best-effort next-input prediction, the way a composer hint works: a
      // short forked call over the last exchange, shown only once the
      // composer is empty again. Fire-and-forget; a failure costs nothing.
      if (lastAssistantTextRef.current) {
        void generatePromptSuggestion(
          `User: ${lastUserMessageRef.current ?? ""}\nAssistant: ${lastAssistantTextRef.current.slice(0, 2000)}`,
        );
      }

      // Hand the queue to the shared drain loop. Unconditional, even when
      // empty: this is what lets a browser-enqueued message reach an idle
      // TUI. The dequeue event already removed the row from the view.
      turnRunnerService.startDraining((queued, signal) =>
        runOneTurn(queued, signal, processQueuedMessage),
      );
    }
  };

  const handleSlashCommandProcessing = async (
    message: string,
  ): Promise<string | null> => {
    // Handle slash commands
    if (!assistant) {
      return message;
    }

    const commandResult = await handleSlashCommands(message, assistant);

    if (!commandResult) {
      return message;
    }

    if (commandResult.compact) {
      // Compaction rewrites the history a running turn is reading. Reached
      // mid-turn it defers back to the queue and runs at the boundary, as in
      // the reference CLI.
      if (turnRunningRef.current) {
        void messageQueue.enqueueMessage(message);
        return null;
      }
      await handleCompactCommand({
        chatHistory,
        model,
        llmApi,
        setChatHistory,
        setCompactionIndex,
        currentSession,
        setCurrentSession,
        setIsCompacting,
        setCompactionStartTime,
        setCompactionAbortController,
      });
      return null;
    }

    const newInput = processSlashCommandResult({
      result: commandResult,
      chatHistory,
      setChatHistory,
      onShowModelSelector,
      onShowMCPSelector,
      onShowMcpMarketplace,
      onShowSessionSelector,
      onShowSubagentsSelector,
      onLoadSession,
      onShowJobsSelector,
      onShowUpdateSelector,
      onShowThemeSelector,
      onShowExportSelector,
      onClear,
      onShowStatusMessage,
    });

    // A prompt command falls through to start a turn of its own; mid-turn
    // that would race the running stream, so it defers to the boundary too.
    if (newInput && turnRunningRef.current) {
      void messageQueue.enqueueMessage(message);
      return null;
    }

    return newInput || null;
  };

  const convertMessageContentToString = (content: any): string => {
    if (typeof content === "string") {
      return content;
    }

    // Convert MessagePart[] to string (extracting text, noting images)
    return content
      .map((part: any) => {
        if (part.type === "text") {
          return part.text;
        } else if (part.type === "imageUrl") {
          return "[Image]";
        }
        return "";
      })
      .join("");
  };

  const processMessage = async (
    message: string,
    imageMap?: Map<string, Buffer>,
    isQueuedMessage: boolean = false,
    baseHistory?: ChatHistoryItem[],
  ) => {
    // Use baseHistory if provided (e.g., when editing a message),
    // otherwise use current chatHistory
    const currentHistory = baseHistory ?? chatHistory;
    // Handle special commands
    const handled = await handleSpecialCommands({
      message,
      isRemoteMode,
      remoteUrl,
      exit,
      onShowDiff,
      onShowStatusMessage,
    });

    if (handled) return;

    // Handle shell mode commands (before slash commands)
    const bashProcessedMessage = await handleBashModeProcessing(message);
    if (bashProcessedMessage === null) {
      return; // Bash command was handled and no further processing needed
    }
    message = bashProcessedMessage;

    // Handle slash commands (MUST happen before remote message handling)
    const processedMessage = await handleSlashCommandProcessing(message);
    if (processedMessage === null) {
      return; // Command was handled and no further processing needed
    }
    message = processedMessage;

    // A delegated transcript records a finished run. Slash commands above still
    // work so the user can leave it, but a new turn would silently write into
    // someone else's conversation.
    if (isReadOnlySession) {
      setChatHistory((prev) => [
        ...prev,
        {
          message: { role: "system", content: t("subagent.readOnly") },
          contextItems: [],
        },
      ]);
      return;
    }

    // Nothing can answer without a chat model: say so instead of taking the
    // message and going quiet. The headless path fails the same way, loudly.
    if (!model || !llmApi) {
      setChatHistory((prev) => [
        ...prev,
        {
          message: { role: "system", content: t("chat.noModelConfigured") },
          contextItems: [],
        },
      ]);
      return;
    }

    const promptHook = await fireUserPromptSubmit(message);
    if (promptHook.blocked) {
      onShowStatusMessage?.(
        promptHook.blockReason ?? "Blocked by UserPromptSubmit hook",
      );
      return;
    }
    // The session note leads, then the prompt note, then the files that moved;
    // the user's text stays last, and a note is taken once so it cannot repeat.
    // The uncomposed text is kept for the transcript: surfaces render what the
    // user typed, while the composed prompt is what the model is served.
    const userText = message;
    const hookNotes = [
      takeSessionStartContext(),
      promptHook.additionalContext,
      describeChangedFiles(),
      model ? describeContextBudget(currentHistory, model) : undefined,
    ];
    message = composeServedPrompt(
      message,
      hookNotes.filter((note): note is string => Boolean(note)),
    );

    // Track telemetry
    trackUserMessage(message, model);

    // In remote mode, send message to server instead of processing locally
    if (isRemoteMode && remoteUrl) {
      const messageContentString = convertMessageContentToString(message);

      await handleRemoteMessage({
        remoteUrl,
        messageContent: messageContentString,
      });
      return;
    }

    // For non-queued messages, format and add to chat history
    if (isQueuedMessage) {
      // For queued messages, we need to format and add to history after compaction
      // First, format the message
      const formattedQueuedMessage = await formatMessageWithFiles(
        message,
        [], // No attached files for queued messages
        imageMap,
        userText,
      );

      // Check if auto-compacting is needed with current history
      const compactionController = new AbortController();
      setCompactionAbortController(compactionController);
      setIsCompacting(true);
      setCompactionStartTime(Date.now());

      // Add the queued message to queue display during compaction
      const queuedMessageForDisplay: QueuedMessage = {
        id: `processing-${Date.now()}`,
        message: userText,
        imageMap,
        timestamp: Date.now(),
      };
      setQueuedMessages((prev) => [...prev, queuedMessageForDisplay]);

      let currentChatHistory, currentCompactionIndex;
      try {
        const result = await handleAutoCompaction({
          chatHistory: currentHistory,
          model,
          llmApi,
          compactionIndex,
          setChatHistory: setChatHistory,
          setCompactionIndex,
          abortController: compactionController,
        });
        currentChatHistory = result.currentChatHistory;
        currentCompactionIndex = result.currentCompactionIndex;
      } catch (error) {
        // If compaction fails, remove the queued message from display
        setQueuedMessages((prev) =>
          prev.filter((msg) => msg !== queuedMessageForDisplay),
        );
        throw error; // Re-throw to maintain error handling
      } finally {
        setIsCompacting(false);
        setCompactionStartTime(null);
        setCompactionAbortController(null);
      }

      // Add the formatted queued message to history after compaction completes
      const newHistory = [...currentChatHistory, formattedQueuedMessage];
      setChatHistory(newHistory);

      // Remove the queued message from display since it's now in chat history
      setQueuedMessages((prev) =>
        prev.filter((msg) => msg !== queuedMessageForDisplay),
      );

      // Execute the streaming response with the updated history
      await executeStreamingResponse(newHistory, currentCompactionIndex);
    } else {
      // Format message with attached files and images
      logger.debug("Processing message with images", {
        hasImages: !!(imageMap && imageMap.size > 0),
        imageCount: imageMap?.size || 0,
      });
      const newUserMessage = await formatMessageWithFiles(
        message,
        attachedFiles,
        imageMap,
        userText,
      );
      logger.debug("Message formatted successfully");

      if (attachedFiles.length > 0) {
        setAttachedFiles([]);
      }

      // Check if auto-compacting is needed BEFORE adding user message
      const compactionController = new AbortController();
      setCompactionAbortController(compactionController);
      setIsCompacting(true);
      setCompactionStartTime(Date.now());

      // Add the triggering message to queue display during compaction
      const compactionQueuedMessage: QueuedMessage = {
        id: `compacting-${Date.now()}`,
        message: userText,
        imageMap,
        timestamp: Date.now(),
      };
      setQueuedMessages((prev) => [...prev, compactionQueuedMessage]);

      let currentChatHistory, currentCompactionIndex;
      try {
        const result = await handleAutoCompaction({
          chatHistory: currentHistory,
          model,
          llmApi,
          compactionIndex,
          setChatHistory: setChatHistory,
          setCompactionIndex,
          abortController: compactionController,
        });
        currentChatHistory = result.currentChatHistory;
        currentCompactionIndex = result.currentCompactionIndex;
      } catch (error) {
        // If compaction fails, remove the triggering message from queue display
        setQueuedMessages((prev) =>
          prev.filter((msg) => msg !== compactionQueuedMessage),
        );
        throw error; // Re-throw to maintain error handling
      } finally {
        setIsCompacting(false);
        setCompactionStartTime(null);
        setCompactionAbortController(null);
      }

      // Add the formatted user message to history
      const newHistory = [...currentChatHistory, newUserMessage];
      setChatHistory(newHistory);

      // Remove the triggering message from queue display since it's now in chat history
      setQueuedMessages((prev) =>
        prev.filter((msg) => msg !== compactionQueuedMessage),
      );

      // Execute the streaming response
      await executeStreamingResponse(newHistory, currentCompactionIndex);
    }
  };

  const processQueuedMessage = async (
    message: string,
    imageMap?: Map<string, Buffer>,
  ) => {
    // For queued messages, we can reuse the core message processing logic
    // by calling the internal processing function directly
    await processMessage(message, imageMap, true);
  };

  // A browser-enqueued message can arrive long after the last drain loop
  // retired, so the pipeline is registered process-wide: any surface that
  // needs the queue drained starts a loop running turns through this hook.
  // The ref indirection keeps the pipeline reading current hook state.
  const queuedPipelineRef = useRef(async (queued: QueuedMessage) => {
    await processQueuedMessage(queued.message, queued.imageMap);
  });
  queuedPipelineRef.current = async (queued: QueuedMessage) => {
    await processQueuedMessage(queued.message, queued.imageMap);
  };

  useEffect(() => {
    turnRunnerService.setDefaultRunTurn((queued, signal) =>
      runOneTurn(queued, signal, () => queuedPipelineRef.current(queued)),
    );
  }, []);

  const handleUserMessage = async (
    message: string,
    imageMap?: Map<string, Buffer>,
  ) => {
    // Use the common message processing logic
    lastUserMessageRef.current = message;
    await processMessage(message, imageMap, false);
  };

  const handleInterrupt = () => {
    // In remote mode, send interrupt signal to server
    if (isRemoteMode && remoteUrl) {
      // Send a message to interrupt the remote server
      fetch(`${remoteUrl}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "" }), // Empty message triggers interrupt
      }).catch((error) => {
        logger.error("Failed to send interrupt to remote server:", error);
      });
      return;
    }

    // Local mode: abort the appropriate controller

    // If compaction is running, abort compaction
    if (compactionAbortController && isCompacting) {
      compactionAbortController.abort();
      setIsCompacting(false);
      setCompactionStartTime(null);
      setCompactionAbortController(null);
      setInputMode(true);
      // Clear any queued messages (including the triggering message) when compaction is interrupted
      messageQueue.clearMessages();
      return;
    }

    // If response is running, abort response
    if (abortController && isWaitingForResponse) {
      abortController.abort();

      // claude code's split: a turn with no answer yet gives the message back
      // to the composer for editing, so nothing is displayed for it; a turn
      // that already produced output keeps the partial answer on screen and
      // the streaming bracket reports the interruption.
      const producedOutput =
        (streamingText?.length ?? 0) > 0 ||
        (streamingReasoning?.length ?? 0) > 0;
      setChatHistory((current) => {
        const lastMessage = current[current.length - 1];
        if (
          lastMessage?.message.role === "assistant" &&
          !lastMessage.toolCallStates?.length
        ) {
          return current.slice(0, -1);
        }
        return current;
      });

      if (!producedOutput) {
        const lastItem = chatHistory[chatHistory.length - 1];
        const rolledBack =
          lastUserMessageRef.current ??
          (lastItem?.message.role === "user"
            ? String(lastItem.message.content)
            : "");
        if (lastItem?.message.role === "user") {
          setChatHistory((current) =>
            current.length > 0 && current[current.length - 1] === lastItem
              ? current.slice(0, -1)
              : current,
          );
        }
        if (rolledBack) {
          requestComposerDraft(rolledBack);
        }
        setIsWaitingForResponse(false);
        setResponseStartTime(null);
        setInputMode(true);
        return;
      }

      setWasInterrupted(true);
      setIsWaitingForResponse(false);
      setResponseStartTime(null);
      setInputMode(true);
      onShowStatusMessage?.(t("interrupted.notice"));
    }
  };

  const handleFileAttached = (filePath: string, content: string) => {
    setAttachedFiles((prev) => [...prev, { path: filePath, content }]);
  };

  const resetChatHistory = async () => {
    const newHistory = await initChatHistory(
      false, // Don't resume when resetting
      additionalRules,
    );
    setChatHistory(newHistory);
    // Clear any queued messages when resetting chat
    messageQueue.clearMessages();
  };

  const handleEditMessage = async (
    messageIndex: number,
    newContent: string,
  ) => {
    logger.debug("handleEditMessage called", {
      messageIndex,
      currentHistoryLength: chatHistory.length,
    });

    // Rewind chat history to exclude the message being edited
    const rewindedHistory = chatHistory.slice(0, messageIndex);

    logger.debug("Rewinding history for edit", {
      from: chatHistory.length,
      to: rewindedHistory.length,
    });

    // Clear any queued messages
    messageQueue.clearMessages();

    // The per-section prefix facts were measured against a history window the
    // rewind just removed, so they are dropped: the next round reinjects the
    // sections whole. Safe to call when no series or baselines exist.
    clearSeriesSectionBaselines(currentPromptCacheKey());

    // Clear attached files
    setAttachedFiles([]);

    // Update the session with the rewound history
    updateSessionHistory(rewindedHistory);

    // Force refresh of the transcript to show truncated history
    if (onRefreshStatic) {
      onRefreshStatic();
    }

    // Resubmit the edited message with the rewound history as the base
    // This ensures processMessage uses the correct base history
    await processMessage(newContent, undefined, false, rewindedHistory);
  };

  const handleToolPermissionResponse = async (
    requestId: string,
    approved: boolean,
    createPolicy?: boolean,
    stopStream?: boolean,
    forSession?: boolean,
  ) => {
    // Capture the current permission request before clearing it
    const currentRequest = activePermissionRequest;

    // Clear the active permission request
    setActivePermissionRequest(null);

    // Held in memory for this session only: no file is written and no
    // permission reload is needed, because nothing outside this process changes.
    if (approved && forSession && currentRequest) {
      const { rememberSessionApproval } =
        await import("../../permissions/sessionApprovals.js");
      const key = rememberSessionApproval(
        currentRequest.toolName,
        currentRequest.toolArgs,
      );
      logger.debug(
        key
          ? `Approval held for this session: ${key}`
          : `Approval for ${currentRequest.toolName} cannot be held for the session`,
      );
    }

    // Handle policy creation if requested
    if (approved && createPolicy && currentRequest) {
      try {
        const { generatePolicyRule, addPolicyRule } =
          await import("../../permissions/policyWriter.js");

        const policyRule = generatePolicyRule(
          currentRequest.toolName,
          currentRequest.toolArgs,
        );

        await addPolicyRule(policyRule);
        logger.debug(`Policy created: ${policyRule}`);

        // Reload permissions to pick up the new policy without requiring restart
        await services.toolPermissions.reloadPermissions();
      } catch (error) {
        logger.error("Failed to create policy or reload permissions", {
          error,
        });
        // Continue with the approval even if policy creation/reload fails
      }
    }

    // Send response to permission manager
    // The streamChatResponse will handle showing the appropriate message
    // through its normal onToolStart/onToolError flow
    if (approved) {
      interactionBroker.approve(requestId, createPolicy === true);
    } else {
      interactionBroker.reject(requestId);

      // If this is a "stop stream" rejection, abort the current request
      if (stopStream && abortController && isWaitingForResponse) {
        abortController.abort();
        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content:
                "[Tool canceled - please tell TNT what to do differently]",
            },
            contextItems: [],
          },
        ]);
        setIsWaitingForResponse(false);
        setResponseStartTime(null);
        setInputMode(true);
      }
    }
  };

  const handleQuizAnswer = (
    requestId: string,
    answer: string,
    isCustomAnswer = false,
    answers?: QuizItemAnswer[],
  ) => {
    setActiveQuizQuestion(null);
    interactionBroker.answerQuestion(
      requestId,
      answer,
      isCustomAnswer,
      answers,
    );
  };

  // A stop request from another surface (the web UI) truncates the in-flight
  // turn the same way Esc does. The ref keeps the handler reading current
  // state rather than the mount-time closure.
  const interruptRef = useRef(handleInterrupt);
  interruptRef.current = handleInterrupt;
  useEffect(() => {
    return registerStopRequestListener(() => interruptRef.current);
  }, []);

  return {
    chatHistory,
    setChatHistory: setChatHistory,
    isWaitingForResponse,
    responseStartTime,
    isCompacting,
    compactionStartTime,
    inputMode,
    attachedFiles,
    activePermissionRequest,
    activeQuizQuestion,
    wasInterrupted,
    queuedMessages,
    streamingText,
    streamingReasoning,
    handleUserMessage,
    handleInterrupt,
    handleFileAttached,
    resetChatHistory,
    handleEditMessage,
    handleToolPermissionResponse,
    handleQuizAnswer,
  };
}
