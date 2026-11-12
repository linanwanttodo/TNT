import type { Session } from "core/index.js";
import { Box } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { fireConfigChange } from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import { ToolPermissionServiceState } from "../services/ToolPermissionService.js";
import {
  ApiClientServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
  UpdateServiceState,
} from "../services/types.js";
import { getCurrentSession, getTotalSessionCost } from "../session/index.js";
import { logger } from "../utils/logger.js";
import { liveHub, type LiveRuntime } from "../webuiZcode/liveHub.js";

import { handleSlashCommands } from "./commands/index.js";
import { Composer } from "./components/Composer.js";
import { MainContent } from "./components/MainContent.js";
import {
  persistThemeChoice,
  readPersistedTheme,
  themeOfChoice,
} from "./components/ThemeSelector.js";
import { useNavigation } from "./context/NavigationContext.js";
import { useChat } from "./hooks/useChat.js";
import { useChatViewport } from "./hooks/useChatViewport.js";
import { useContextPercentage } from "./hooks/useContextPercentage.js";
import { useContextReadout } from "./hooks/useContextReadout.js";
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
import { useTurnSummary } from "./hooks/useTurnSummary.js";
import {
  useTerminalStatusLight,
  type SessionStatus,
} from "./terminalStatusLight.js";
import {
  detectedTerminalIsDark,
  normalizeThemeChoice,
} from "./theme/terminalAppearance.js";
import { ThemeProvider, type ThemeName } from "./theme/tokens.js";
import { sanitizeTerminalText } from "./utils/terminalTextSafety.js";

interface TUIChatProps {
  // Remote mode props
  remoteUrl?: string;

  // Local mode props - now optional since we'll get them from services
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
    config: ConfigServiceState;
    model: ModelServiceState;
    mcp: MCPServiceState;
    apiClient: ApiClientServiceState;
    update: UpdateServiceState;
    toolPermissions: ToolPermissionServiceState;
  }>(["config", "model", "mcp", "apiClient", "update", "toolPermissions"]);

  return { services, allServicesReady, isRemoteMode };
}

// Organization names are no longer available (Hub integration removed)
// Custom hook for chat handlers
function useChatHandlers(
  setShowIntroMessage: (show: boolean) => void,
  setStaticRefreshTrigger: React.Dispatch<React.SetStateAction<number>>,
  resetTranscript: () => void,
) {
  // Temporary refs to avoid circular dependency
  const resetChatHistoryRef = useRef<(() => void) | null>(null);

  // Handle clearing chat and resetting intro message
  const handleClear = useCallback(() => {
    liveHub.notifySessionChanged();
    setShowIntroMessage(true);
    // Drop the printed transcript too: `/clear` means the conversation on
    // screen and in the scrollback is gone, not just the model's context.
    resetTranscript();
    // Trigger static content refresh by incrementing the trigger
    setStaticRefreshTrigger((prev) => prev + 1);
  }, [setShowIntroMessage, setStaticRefreshTrigger, resetTranscript]);

  // Service reload handlers - these will trigger reactive updates
  const handleReload = useCallback(async () => {
    await fireConfigChange("reload").catch(() => {});
    // Services will automatically update the UI when they reload
    // We just need to reset chat history, intro message, and clear the screen
    if (resetChatHistoryRef.current) {
      resetChatHistoryRef.current();
    }
    setShowIntroMessage(false);
    resetTranscript();
  }, [setShowIntroMessage, resetTranscript]);

  return {
    handleClear,
    handleReload,
    resetChatHistoryRef,
  };
}

const TUIChat: React.FC<TUIChatProps> = ({
  remoteUrl,
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

  // Forces a re-render after a selector changes something the hook's own
  // state does not track (the selected config or model).
  const [, setStaticRefreshTrigger] = useState(0);

  // Replacing the conversation remounts the transcript subtree, so Ink erases
  // exactly the rows that went away.
  const [transcriptEpoch, setTranscriptEpoch] = useState(0);
  const resetTranscript = useCallback(() => {
    setTranscriptEpoch((epoch) => epoch + 1);
  }, []);

  // Session on screen; a delegated transcript is locked and read-only.
  const [displayedSession, setDisplayedSession] = useState<Session | null>(
    null,
  );
  const subagentView = useSubagentView(displayedSession);

  // Session switching lives here, so /back reaches it through a ref.
  const loadSessionRef = useRef<(sessionId: string) => void>(() => {});

  // Use chat handlers hook
  const { handleClear, handleReload, resetChatHistoryRef } = useChatHandlers(
    setShowIntroMessage,
    setStaticRefreshTrigger,
    resetTranscript,
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
    streamingReasoning,
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
    onShowModelSelector: () => navigateTo("model"),
    onShowMCPSelector: () => navigateTo("mcp"),
    onShowMcpMarketplace: () => navigateTo("mcpMarket"),
    onShowPluginsBrowser: () => navigateTo("plugins"),
    onShowUpdateSelector: () => navigateTo("update"),
    onShowThemeSelector: () => navigateTo("theme"),
    onShowSessionSelector: () => navigateTo("session"),
    onShowSubagentsSelector: () => navigateTo("subagents"),
    onLoadSession: (id: string) => loadSessionRef.current(id),
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

  const handleUserMessageRef = useRef(handleUserMessage);
  handleUserMessageRef.current = handleUserMessage;

  useEffect(() => {
    if (isRemoteMode) return;
    const runtime: LiveRuntime = {
      runtimeId: `tui-${process.pid}`,
      handleUserMessage: (text: string) => {
        void handleUserMessageRef.current(text);
      },
      session: () => {
        const current = getCurrentSession();
        return {
          sessionId: current.sessionId,
          title: current.title,
          workspaceDirectory: current.workspaceDirectory || process.cwd(),
        };
      },
      workingDir: () => process.cwd(),
      providerInfo: () => {
        const model = services.model?.model;
        return {
          provider: (model as any)?.provider || "local",
          model: model?.name || model?.model || "local",
        };
      },
      // The browser asks the screen to run `/status` and friends; the answer
      // is screen output and stays out of the shared history.
      runCommand: async (name: string, args: string[]) => {
        const assistant = services.config?.config || undefined;
        if (!assistant) return null;
        const composed = `/${name}${args.length ? ` ${args.join(" ")}` : ""}`;
        const result = await handleSlashCommands(composed, assistant);
        if (!result) return null;
        const output = sanitizeTerminalText(result.output ?? "");
        return output.length > 0 ? output : null;
      },
      selectSession: (sessionId) => {
        loadSessionRef.current(sessionId);
      },
    };
    liveHub.bind(runtime);
    return () => liveHub.unbind(runtime.runtimeId);
    // The runtime reads services and handlers through refs and live state,
    // so it binds once per mount.
  }, [isRemoteMode]);

  useMcpFailureNotice(services.mcp, setChatHistory);

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

  const contextReadout = useContextReadout(
    contextData,
    services.model?.model?.provider,
  );
  const turnSummary = useTurnSummary(
    isWaitingForResponse,
    responseStartTime,
    chatHistory,
  );

  const { renderMessage } = useMessageRenderer();

  const { handleModelSelect } = useSelectors(
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
      // The browser follows the screen to the picked conversation.
      liveHub.notifySessionChanged();
      // The resumed conversation is printed from scratch, so drop whatever
      // the previous one left in the terminal.
      resetTranscript();
    },
    [closeCurrentScreen, setChatHistory, setShowIntroMessage, resetTranscript],
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

  // Fetch organization name based on auth state

  const isBashToolRunning = useBashToolRunning();

  // The dock stays pinned to the bottom of the alternate screen; scrolling
  // moves the transcript window instead of the terminal, so the composer can
  // never scroll away from the reader.
  const { rows } = useTerminalSize();
  const { following, scrollTop, onMetrics, jumpToBottom } = useChatViewport({
    isActive: navState.currentScreen === "chat",
  });

  // The setting the session opened with, before any picker preview.
  const configuredChoice = useMemo<ThemeName | "auto">(() => {
    const configured =
      process.env.TNT_THEME ||
      readPersistedTheme() ||
      (services.config?.config as any)?.theme;
    return normalizeThemeChoice(
      configured === undefined ? undefined : String(configured),
    );
  }, [services.config?.config]);

  // "auto" keeps following the probe; a preview overrides it while open.
  const [themeChoice, setThemeChoice] = useState<ThemeName | "auto">(
    configuredChoice,
  );
  const [previewChoice, setPreviewChoice] = useState<ThemeName | "auto" | null>(
    null,
  );
  // Resolved once before Ink owns stdin in startTUIChat; a terminal that never
  // answers leaves this undefined and the auto theme stays dark.
  const detected = detectedTerminalIsDark();

  const activeChoice = previewChoice ?? themeChoice;

  useEffect(() => {
    setThemeChoice(configuredChoice);
  }, [configuredChoice]);

  const currentTheme = themeOfChoice(activeChoice, detected);

  // The title spins only while the model works.
  const sessionStatus: SessionStatus = activePermissionRequest
    ? "waiting"
    : activeQuizQuestion
      ? "waiting"
      : isWaitingForResponse || isCompacting
        ? "working"
        : "idle";
  // The tab title carries the product and the folder, nothing else.
  const workspaceName =
    process.cwd().split(/[\\/]/).filter(Boolean).pop() ?? "";
  useTerminalStatusLight(sessionStatus, workspaceName);

  const handlePreviewTheme = useCallback((themeName: ThemeName | "auto") => {
    setPreviewChoice(themeName);
  }, []);

  const handleCancelThemePreview = useCallback(() => {
    setPreviewChoice(null);
    closeCurrentScreen();
  }, [closeCurrentScreen]);

  const handleSelectTheme = useCallback(
    (themeName: ThemeName | "auto") => {
      persistThemeChoice(themeName);
      setThemeChoice(themeName);
      setPreviewChoice(null);
      closeCurrentScreen();
    },
    [closeCurrentScreen],
  );

  // Ink's terminal buffer owns the physical rows in both modes. Keep the
  // composer dock pinned to the bottom; the transcript's ScrollView owns its
  // viewport and the terminal buffer keeps frame updates from duplicating text.
  return (
    <ThemeProvider theme={currentTheme}>
      <Box flexDirection="column" height={rows} overflowY="hidden">
        <MainContent
          key={transcriptEpoch}
          showIntroMessage={showIntroMessage && !isRemoteMode}
          chatHistory={chatHistory}
          queuedMessages={queuedMessages}
          renderMessage={renderMessage}
          streamingText={streamingText}
          turnSummary={turnSummary}
          streamingReasoning={streamingReasoning}
          isWaitingForResponse={isWaitingForResponse}
          responseStartTime={responseStartTime}
          isCompacting={isCompacting}
          compactionStartTime={compactionStartTime}
          isBashToolRunning={isBashToolRunning}
          verbose={isVerboseMode}
          scrollTop={scrollTop}
          onScrollMetrics={onMetrics}
          showScrollbar
        />

        <Composer
          contextReadout={contextReadout}
          following={following}
          onJumpToLatest={jumpToBottom}
          statusMessage={statusMessage}
          isScreenActive={isScreenActive}
          services={services}
          handleModelSelect={handleModelSelect}
          handleSessionSelect={handleSessionSelect}
          handleExportSession={handleExportSession}
          handleReload={handleReload}
          closeCurrentScreen={closeCurrentScreen}
          activePermissionRequest={activePermissionRequest}
          activeQuizQuestion={activeQuizQuestion}
          handleToolPermissionResponse={handleToolPermissionResponse}
          handleQuizAnswer={handleQuizAnswer}
          handleUserMessage={(message, imageMap) => {
            // Sending always returns to the live tail, the way every reference
            // CLI resumes following when the user speaks.
            jumpToBottom();
            void handleUserMessage(message, imageMap);
          }}
          isWaitingForResponse={isWaitingForResponse}
          isCompacting={isCompacting}
          queuedCount={queuedMessages?.length ?? 0}
          inputMode={inputMode}
          handleInterrupt={handleInterrupt}
          handleFileAttached={handleFileAttached}
          isInputDisabled={isInputDisabled}
          wasInterrupted={wasInterrupted}
          isRemoteMode={isRemoteMode}
          remoteUrl={remoteUrl}
          diffContent={diffContent}
          chatHistory={chatHistory}
          handleEditMessage={handleEditMessage}
          onShowEditSelector={() => navigateTo("edit")}
          onShowAddModelSelector={() => navigateTo("addModel")}
          onOpenPalette={() => navigateTo("palette")}
          onOpenJobs={() => navigateTo("jobs")}
          onPreviewTheme={handlePreviewTheme}
          onCancelThemePreview={handleCancelThemePreview}
          onSelectTheme={handleSelectTheme}
          subagentView={subagentView}
          navState={navState}
          navigateTo={navigateTo}
          contextPercentage={contextData?.percentage ?? undefined}
          contextTokens={contextData?.tokenCount ?? undefined}
          isVerboseMode={isVerboseMode}
          totalCost={getTotalSessionCost()}
        />
      </Box>
    </ThemeProvider>
  );
};

export { TUIChat };
