import { Box, Text, useInput } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";

import { fireConfigChange } from "../hooks/fireHook.js";
import { useServices } from "../hooks/useService.js";
import {
  ApiClientServiceState,
  AuthServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
  UpdateServiceState,
} from "../services/types.js";
import { getTotalSessionCost } from "../session.js";
import { bashToolEvents } from "../util/cli.js";
import { logger } from "../util/logger.js";

import { ActionStatus } from "./components/ActionStatus.js";
import { BottomStatusBar } from "./components/BottomStatusBar.js";
import { ResourceDebugBar } from "./components/ResourceDebugBar.js";
import { ScreenContent } from "./components/ScreenContent.js";
import { StaticChatContent } from "./components/StaticChatContent.js";
import { useNavigation } from "./context/NavigationContext.js";
import { useLocale } from "./hooks/useLocale.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { estimateHistoryHeight } from "./utils/wrappedLineCount.js";
import { useChat } from "./hooks/useChat.js";
import { useContextPercentage } from "./hooks/useContextPercentage.js";
import { useMessageRenderer } from "./hooks/useMessageRenderer.js";
import { useIntroMessage, useSelectors } from "./hooks/useTUIChatHooks.js";
import { t } from "../i18n/index.js";

interface TUIChatProps {
  // Remote mode props
  remoteUrl?: string;

  // Local mode props - now optional since we'll get them from services
  configPath?: string;
  initialPrompt?: string;
  resume?: boolean;
  fork?: string;
  additionalRules?: string[];
  additionalPrompts?: string[];
}

// Helper function to load and set session
async function loadAndSetSession(
  sessionId: string,
  closeCurrentScreen: () => void,
  setChatHistory: (history: any) => void,
  setShowIntroMessage: (show: boolean) => void,
) {
  try {
    // Close the session selector
    closeCurrentScreen();

    // Import session functions
    const { loadSessionById } = await import("../session.js");

    // Load the session
    const session = loadSessionById(sessionId);
    if (!session) {
      logger.error(`Session ${sessionId} could not be loaded.`);
      return;
    }

    // Set the session ID so future operations use this session
    process.env.CONTINUE_CLI_TEST_SESSION_ID = sessionId.replace(
      "continue-cli-",
      "",
    );

    // Set the chat history from the session
    setChatHistory(session.history);

    // Clear the intro message since we're now showing a resumed session
    setShowIntroMessage(false);
  } catch (error) {
    console.error("Error loading session:", error);
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
function useOrganizationName(_organizationId?: string): string | undefined {
  const organizationName = undefined;

  return organizationName;
}

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

// eslint-disable-next-line complexity
const TUIChat: React.FC<TUIChatProps> = ({
  remoteUrl,
  configPath,
  initialPrompt,
  resume,
  fork,
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
    fork,
    additionalRules,
    additionalPrompts,
    onShowConfigSelector: () => navigateTo("config"),
    onShowModelSelector: () => navigateTo("model"),
    onShowMCPSelector: () => navigateTo("mcp"),
    onShowUpdateSelector: () => navigateTo("update"),
    onShowSessionSelector: () => navigateTo("session"),
    onShowJobsSelector: () => navigateTo("jobs"),
    onShowExportSelector: () => navigateTo("export"),
    onReload: handleReload,
    onClear: handleClear,
    onRefreshStatic: () => setStaticRefreshTrigger((prev) => prev + 1),
    // Remote mode configuration
    isRemoteMode,
    remoteUrl,
    onShowDiff: handleShowDiff,
    onShowStatusMessage: handleShowStatusMessage,
  });

  // Transcript scroll: how many lines the history is scrolled up from the
  // bottom. Pinned to the bottom (0) by default.
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollToBottom = useCallback(() => setScrollOffset(0), []);

  // Estimate the total transcript height in rows; used to bound how far the
  // user can scroll up before hitting the oldest content.
  const { columns, rows } = useTerminalSize();
  const transcriptHeight = estimateHistoryHeight(
    (chatHistory?.length ?? 0) + (showIntroMessage && !isRemoteMode ? 1 : 0),
    columns,
  );
  // Rows available to the scrollable transcript viewport (history box minus the
  // fixed bottom section: status/action lines, composer, status bar, arrow).
  const bottomSectionReserve = 8;
  const visibleRows = Math.max(1, rows - bottomSectionReserve);
  const maxScrollOffset = Math.max(0, transcriptHeight - visibleRows);

  // Keyboard scrolling of the transcript. Only active on the chat screen and
  // when no selector/screen is open, so it never fights text entry or menus.
  useInput((_input, key) => {
    if (navState.currentScreen !== "chat") {
      return;
    }
    if (isScreenActive && Object.values(isScreenActive).some((v) => v)) {
      return;
    }
    if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, prev - visibleRows));
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.min(maxScrollOffset, prev + visibleRows));
    } else if (key.downArrow && scrollOffset < maxScrollOffset) {
      // A plain down arrow nudges toward the newest content when scrolled up.
      setScrollOffset((prev) => Math.min(maxScrollOffset, prev + 1));
    } else if (key.upArrow && scrollOffset > 0) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else {
      return;
    }
  });

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
      );
    },
    [closeCurrentScreen, setChatHistory, setShowIntroMessage],
  );

  // Export session handler
  const handleExportSession = useCallback(
    async (sessionId: string) => {
      try {
        const { loadSessionById } = await import("../session.js");
        const fs = await import("fs");
        const path = await import("path");

        const session = loadSessionById(sessionId);
        if (!session) {
          setChatHistory((prev) => [
            ...prev,
            {
              message: {
                role: "system",
                content: `Failed to export: Session ${sessionId} not found`,
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
              content: `Session exported to ${defaultPath}`,
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
              content: `Failed to export session: ${error.message}`,
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
  const organizationName = useOrganizationName(services.auth?.organizationId);

  // Track if a Bash tool is currently running via events
  const [isBashToolRunning, setIsBashToolRunning] = useState(false);

  useEffect(() => {
    const handleStarted = () => setIsBashToolRunning(true);
    const handleEnded = () => setIsBashToolRunning(false);

    bashToolEvents.on("started", handleStarted);
    bashToolEvents.on("ended", handleEnded);

    return () => {
      bashToolEvents.off("started", handleStarted);
      bashToolEvents.off("ended", handleEnded);
    };
  }, []);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Chat history - takes up all available space above input */}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
      >
        {/* Debug component - comment out when not needed */}
        {/* {!isRemoteMode && (
          <ServiceDebugger
            services={services}
            loading={servicesLoading}
            error={servicesError}
            allReady={allServicesReady}
            servicesLoading={servicesLoading}
            servicesError={servicesError}
          />
        )} */}

        {/* Chat content with intro message and messages in static container */}
        <StaticChatContent
          showIntroMessage={showIntroMessage && !isRemoteMode}
          config={services.config?.config || undefined}
          model={services.model?.model || undefined}
          mcpService={services.mcp?.mcpService || undefined}
          organizationName={organizationName}
          chatHistory={chatHistory}
          queuedMessages={queuedMessages}
          renderMessage={renderMessage}
          refreshTrigger={staticRefreshTrigger}
          scrollOffset={scrollOffset}
          visibleRows={visibleRows}
          onScrollToBottom={scrollToBottom}
        />
      </Box>

      {/* Down-arrow affordance: shown when the transcript is scrolled up so the
          user can jump back to the newest content. */}
      {scrollOffset > 0 && (
        <Box flexDirection="column" flexShrink={0}>
          <Box
            alignSelf="center"
            borderStyle="round"
            borderColor="blue"
            paddingX={1}
          >
            <Text color="blue" bold>
              {"↓ "}
              {t("scroll.bottom")}
            </Text>
          </Box>
        </Box>
      )}

      {/* Fixed bottom section */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Status */}
        <ActionStatus
          visible={isWaitingForResponse && !!responseStartTime}
          startTime={responseStartTime || 0}
          message=""
          showSpinner={true}
          additionalHint={
            isBashToolRunning ? t("action.background") : undefined
          }
        />

        {/* Compaction Status */}
        <ActionStatus
          visible={isCompacting && !!compactionStartTime}
          startTime={compactionStartTime || 0}
          message={t("action.compacting")}
          showSpinner={true}
          loadingColor="grey"
        />

        {/* Temporary status message */}
        {statusMessage && (
          <Box paddingX={1} paddingY={0}>
            <Text color="green">{statusMessage}</Text>
          </Box>
        )}

        {/* All screen-specific content */}
        <ScreenContent
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
          handleUserMessage={handleUserMessage}
          isWaitingForResponse={isWaitingForResponse}
          isCompacting={isCompacting}
          inputMode={inputMode}
          handleInterrupt={handleInterrupt}
          handleFileAttached={handleFileAttached}
          isInputDisabled={isInputDisabled}
          wasInterrupted={wasInterrupted}
          isRemoteMode={isRemoteMode}
          onImageInClipboardChange={setHasImageInClipboard}
          diffContent={diffContent}
          chatHistory={chatHistory}
          handleEditMessage={handleEditMessage}
          onShowEditSelector={() => navigateTo("edit")}
        />

        {/* Resource debug bar - only in verbose mode */}
        {isVerboseMode && !isRemoteMode && (
          <ResourceDebugBar visible={navState.currentScreen === "chat"} />
        )}

        {/* Bottom status bar */}
        <BottomStatusBar
          remoteUrl={remoteUrl}
          isRemoteMode={isRemoteMode}
          services={services}
          navState={navState}
          navigateTo={navigateTo}
          closeCurrentScreen={closeCurrentScreen}
          contextPercentage={contextData?.percentage ?? 0}
          hasImageInClipboard={hasImageInClipboard}
          isVerboseMode={isVerboseMode}
          totalCost={getTotalSessionCost()}
        />
      </Box>
    </Box>
  );
};

export { TUIChat };
