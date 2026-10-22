import type { Session } from "core/index.js";
import { Box } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";

import { fireConfigChange } from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import {
  ApiClientServiceState,
  AuthServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
  UpdateServiceState,
} from "../services/types.js";
import { getTotalSessionCost } from "../session/index.js";
import { logger } from "../utils/logger.js";

import { Composer } from "./components/Composer.js";
import { MainContent } from "./components/MainContent.js";
import { useNavigation } from "./context/NavigationContext.js";
import { useChat } from "./hooks/useChat.js";
import { useChatViewport } from "./hooks/useChatViewport.js";
import { useContextPercentage } from "./hooks/useContextPercentage.js";
import { useLocale } from "./hooks/useLocale.js";
import { useMessageRenderer } from "./hooks/useMessageRenderer.js";
import { useServices } from "./hooks/useService.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import {
  useBashToolRunning,
  useMcpFailureNotice,
  useSubagentView,
} from "./hooks/useTUIChatEffects.js";
import { useIntroMessage, useSelectors } from "./hooks/useTUIChatHooks.js";

interface TUIChatProps {
  // Remote mode props
  remoteUrl?: string;

  // Local mode props - now optional since we'll get them from services
  configPath?: string;
  initialPrompt?: string;
  resume?: boolean;
  /** Specific session a resume should open; omitted means the newest root. */
  sessionId?: string;
  fork?: string;
  /** Model rounds allowed per turn before the turn is cut short. */
  maxSteps?: number;
  additionalRules?: string[];
  additionalPrompts?: string[];
}

// Helper function to load and set session
async function loadAndSetSession(
  sessionId: string,
  closeCurrentScreen: () => void,
  setChatHistory: (history: any) => void,
  setShowIntroMessage: (show: boolean) => void,
  setDisplayedSession: (session: Session | null) => void,
) {
  try {
    // Close the session selector
    closeCurrentScreen();

    // Import session functions
    const { selectSession } = await import("../session/index.js");

    // Load the session and move the session manager onto it, so later saves
    // append to the conversation on screen.
    const session = selectSession(sessionId);
    if (!session) {
      logger.error(`Session ${sessionId} could not be loaded.`);
      return;
    }

    // Set the chat history from the session
    setChatHistory(session.history);

    // Track which session is on screen so a delegated transcript can be
    // labelled and made read-only.
    setDisplayedSession(session);

    // Clear the intro message since we're now showing a resumed session
    setShowIntroMessage(false);
  } catch (error) {
    console.error(t("chat.sessionLoadFailed"), error);
  }
}

// Custom hook to manage services
function useTUIChatServices(remoteUrl?: string) {
  const isRemoteMode = useMemo(() => !!remoteUrl, [remoteUrl]);

  const { services, allReady: allServicesReady } = useServices<{
    auth: AuthServiceState;
    config: ConfigServiceState;
    model: ModelServiceState;
    mcp: MCPServiceState;
    apiClient: ApiClientServiceState;
    update: UpdateServiceState;
    toolPermissions: ToolPermissionServiceState;
  }>([
    "auth",
    "config",
    "model",
    "mcp",
    "apiClient",
    "update",
    "toolPermissions",
  ]);

  return { services, allServicesReady, isRemoteMode };
}

// Organization names are no longer available (Hub integration removed)
// Custom hook for chat handlers
function useChatHandlers(
  setShowIntroMessage: (show: boolean) => void,
  setStaticRefreshTrigger: React.Dispatch<React.SetStateAction<number>>,
) {
  // Temporary refs to avoid circular dependency
  const resetChatHistoryRef = useRef<(() => void) | null>(null);

  // Handle clearing chat and resetting intro message
  const handleClear = useCallback(() => {
    setShowIntroMessage(true);
    // Trigger static content refresh by incrementing the trigger
    setStaticRefreshTrigger((prev) => prev + 1);
  }, [setShowIntroMessage, setStaticRefreshTrigger]);

  // Service reload handlers - these will trigger reactive updates
  const handleReload = useCallback(async () => {
    await fireConfigChange("reload").catch(() => {});
    // Services will automatically update the UI when they reload
    // We just need to reset chat history, intro message, and clear the screen
    if (resetChatHistoryRef.current) {
      resetChatHistoryRef.current();
    }
    setShowIntroMessage(false);
    process.stdout.write("\x1b[2J\x1b[H");
  }, [setShowIntroMessage]);

  return {
    handleClear,
    handleReload,
    resetChatHistoryRef,
  };
}

const TUIChat: React.FC<TUIChatProps> = ({
  remoteUrl,
  configPath,
  initialPrompt,
  resume,
  sessionId,
  fork,
  maxSteps,
  additionalRules,
  additionalPrompts,
}) => {
  useLocale();

  // Use custom hook for services
  const { services, allServicesReady, isRemoteMode } =
    useTUIChatServices(remoteUrl);

  // Use navigation context
  const {
    state: navState,
    navigateTo,
    closeCurrentScreen,
    isScreenActive,
  } = useNavigation();

  // Use intro message hook
  const [showIntroMessage, setShowIntroMessage] = useIntroMessage(
    isRemoteMode,
    services,
    allServicesReady,
  );

  // State to trigger static content refresh for /clear command
  const [staticRefreshTrigger, setStaticRefreshTrigger] = useState(0);

  // Session currently on screen. Used to label and lock a delegated
  // transcript, which is a record of a finished run rather than a
  // conversation the user can continue.
  const [displayedSession, setDisplayedSession] = useState<Session | null>(
    null,
  );
  const subagentView = useSubagentView(displayedSession);

  // Slash commands are dispatched inside useChat, but session switching lives
  // here, so /back reaches the handler through a ref.
  const loadSessionRef = useRef<(sessionId: string) => void>(() => {});

  // Use chat handlers hook
  const { handleClear, handleReload, resetChatHistoryRef } = useChatHandlers(
    setShowIntroMessage,
    setStaticRefreshTrigger,
  );

  // State for diff content overlay
  const [diffContent, setDiffContent] = useState<string>("");

  // State for temporary status message
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Handler to show diff overlay
  const handleShowDiff = useCallback(
    (content: string) => {
      setDiffContent(content);
      navigateTo("diff");
    },
    [navigateTo],
  );

  // Handler to show temporary status message
  const handleShowStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
    // Clear after 3 seconds
    setTimeout(() => {
      setStatusMessage("");
    }, 3000);
  }, []);

  const {
    chatHistory,
    setChatHistory,
    isWaitingForResponse,
    responseStartTime,
    isCompacting,
    compactionStartTime,
    inputMode,
    activePermissionRequest,
    activeQuizQuestion,
    wasInterrupted,
    queuedMessages,
    streamingText,
    handleUserMessage,
    handleInterrupt,
    handleFileAttached,
    resetChatHistory,
    handleEditMessage,
    handleToolPermissionResponse,
    handleQuizAnswer,
  } = useChat({
    assistant: services.config?.config || undefined,
    model: services.model?.model || undefined,
    llmApi: services.model?.llmApi || undefined,
    initialPrompt,
    resume,
    sessionId,
    fork,
    maxSteps,
    additionalRules,
    additionalPrompts,
    onShowConfigSelector: () => navigateTo("config"),
    onShowModelSelector: () => navigateTo("model"),
    onShowMCPSelector: () => navigateTo("mcp"),
    onShowMcpMarketplace: () => navigateTo("mcpMarket"),
    onShowUpdateSelector: () => navigateTo("update"),
    onShowSessionSelector: () => navigateTo("session"),
    onShowSubagentsSelector: () => navigateTo("subagents"),
    onLoadSession: (sessionId: string) => loadSessionRef.current(sessionId),
    onShowJobsSelector: () => navigateTo("jobs"),
    onShowExportSelector: () => navigateTo("export"),
    onReload: handleReload,
    onClear: handleClear,
    onRefreshStatic: () => setStaticRefreshTrigger((prev) => prev + 1),
    // Remote mode configuration
    isRemoteMode,
    remoteUrl,
    isReadOnlySession: !!subagentView,
    onShowDiff: handleShowDiff,
    onShowStatusMessage: handleShowStatusMessage,
  });

  // A submitted message returns the view to the live tail, like Pi: sending
  // while scrolled up would otherwise hide the answer that follows.
  const handleMessageWithFollow = useCallback(
    (message: string, imageMap?: Map<string, Buffer>) => {
      setScrollBack(0);
      return handleUserMessage(message, imageMap);
    },
    [handleUserMessage],
  );

  useMcpFailureNotice(services.mcp, setChatHistory);

  // Only the answer still being written is split from the settled items; the
  // viewport below decides how much of the transcript is visible.
  const liveItemCount =
    isWaitingForResponse || isCompacting || !!activePermissionRequest ? 1 : 0;

  // Update ref after useChat returns
  useEffect(() => {
    resetChatHistoryRef.current = resetChatHistory;
  }, [resetChatHistory]);

  // Memoize the chat history conversion to avoid expensive recalculation on every render

  // Calculate context percentage
  const contextData = useContextPercentage({
    chatHistory,
    model: services.model?.model || undefined,
  });

  const { renderMessage } = useMessageRenderer();

  const { handleConfigSelect, handleModelSelect } = useSelectors(
    configPath,
    setChatHistory,
    handleClear,
    setStaticRefreshTrigger,
  );

  // Session selection handler
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      await loadAndSetSession(
        sessionId,
        closeCurrentScreen,
        setChatHistory,
        setShowIntroMessage,
        setDisplayedSession,
      );
    },
    [closeCurrentScreen, setChatHistory, setShowIntroMessage],
  );

  useEffect(() => {
    loadSessionRef.current = (sessionId: string) => {
      void handleSessionSelect(sessionId);
    };
  }, [handleSessionSelect]);

  // Export session handler
  const handleExportSession = useCallback(
    async (sessionId: string) => {
      try {
        const { loadSessionById } = await import("../session/index.js");
        const fs = await import("fs");
        const path = await import("path");

        const session = loadSessionById(sessionId);
        if (!session) {
          setChatHistory((prev) => [
            ...prev,
            {
              message: {
                role: "system",
                content: t("session.exportMissing", { id: sessionId }),
              },
              contextItems: [],
            },
          ]);
          closeCurrentScreen();
          return;
        }

        const exportPayload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          session,
        };

        const defaultPath = path.join(
          process.cwd(),
          `continue-session-${session.sessionId}.json`,
        );
        const jsonOutput = JSON.stringify(exportPayload, null, 2);
        fs.writeFileSync(defaultPath, jsonOutput, "utf-8");

        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content: t("session.exported", { path: defaultPath }),
            },
            contextItems: [],
          },
        ]);
        closeCurrentScreen();
      } catch (error: any) {
        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content: t("session.exportFailed", { message: error.message }),
            },
            contextItems: [],
          },
        ]);
        closeCurrentScreen();
      }
    },
    [closeCurrentScreen, setChatHistory],
  );

  // Determine if input should be disabled
  // Allow input even when services are loading, but disable for UI overlays
  const isInputDisabled =
    navState.currentScreen !== "chat" ||
    !!activePermissionRequest ||
    !!activeQuizQuestion;

  // Check if verbose mode is enabled for resource debugging
  const isVerboseMode = useMemo(() => process.argv.includes("--verbose"), []);

  // State for image in clipboard status
  const [hasImageInClipboard, setHasImageInClipboard] = useState(false);

  // Fetch organization name based on auth state

  const isBashToolRunning = useBashToolRunning();

  // Scrolling works on messages, not pixels; see useChatViewport.
  const { rows } = useTerminalSize();
  const { setScrollBack, following, dockRef, visibleHistory } = useChatViewport(
    { rows, chatHistory },
  );

  return (
    <Box flexDirection="column" height={rows}>
      <MainContent
        showIntroMessage={showIntroMessage && !isRemoteMode}
        chatHistory={visibleHistory}
        queuedMessages={queuedMessages}
        renderMessage={renderMessage}
        refreshTrigger={staticRefreshTrigger}
        liveItemCount={liveItemCount}
        streamingText={streamingText}
        following={following}
        isWaitingForResponse={isWaitingForResponse}
        responseStartTime={responseStartTime}
        isCompacting={isCompacting}
        compactionStartTime={compactionStartTime}
        isBashToolRunning={isBashToolRunning}
      />

      <Composer
        dockRef={dockRef}
        following={following}
        statusMessage={statusMessage}
        isScreenActive={isScreenActive}
        services={services}
        handleConfigSelect={handleConfigSelect}
        handleModelSelect={handleModelSelect}
        handleSessionSelect={handleSessionSelect}
        handleExportSession={handleExportSession}
        handleReload={handleReload}
        closeCurrentScreen={closeCurrentScreen}
        activePermissionRequest={activePermissionRequest}
        activeQuizQuestion={activeQuizQuestion}
        handleToolPermissionResponse={handleToolPermissionResponse}
        handleQuizAnswer={handleQuizAnswer}
        handleUserMessage={handleMessageWithFollow}
        isWaitingForResponse={isWaitingForResponse}
        isCompacting={isCompacting}
        inputMode={inputMode}
        handleInterrupt={handleInterrupt}
        handleFileAttached={handleFileAttached}
        isInputDisabled={isInputDisabled}
        wasInterrupted={wasInterrupted}
        isRemoteMode={isRemoteMode}
        remoteUrl={remoteUrl}
        onImageInClipboardChange={setHasImageInClipboard}
        diffContent={diffContent}
        chatHistory={chatHistory}
        handleEditMessage={handleEditMessage}
        onShowEditSelector={() => navigateTo("edit")}
        subagentView={subagentView}
        navState={navState}
        navigateTo={navigateTo}
        contextPercentage={contextData?.percentage ?? 0}
        contextTokens={contextData?.tokenCount}
        hasImageInClipboard={hasImageInClipboard}
        isVerboseMode={isVerboseMode}
        totalCost={getTotalSessionCost()}
      />
    </Box>
  );
};

export { TUIChat };
