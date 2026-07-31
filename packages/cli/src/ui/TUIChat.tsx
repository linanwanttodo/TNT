import type { Session } from "core/index.js";
import { Box } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { t } from "../i18n/index.js";
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
import { useComposerCallbacks } from "./hooks/useComposerCallbacks.js";
import { useContextPercentage } from "./hooks/useContextPercentage.js";
import { useContextReadout } from "./hooks/useContextReadout.js";
import { useLocale } from "./hooks/useLocale.js";
import { useMessageRenderer } from "./hooks/useMessageRenderer.js";
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
import { useChatHandlers, useTUIChatServices } from "./TUIChat.hooks.js";
import { sanitizeTerminalText } from "./utils/terminalTextSafety.js";

interface TUIChatProps {
  remoteUrl?: string;

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

  const { services, allServicesReady, isRemoteMode } =
    useTUIChatServices(remoteUrl);

  const {
    state: navState,
    navigateTo,
    closeCurrentScreen,
    isScreenActive,
  } = useNavigation();

  const [showIntroMessage, setShowIntroMessage] = useIntroMessage(
    isRemoteMode,
    services,
    allServicesReady,
  );

  const [, setStaticRefreshTrigger] = useState(0);

  const [transcriptEpoch, setTranscriptEpoch] = useState(0);
  const resetTranscript = useCallback(() => {
    setTranscriptEpoch((epoch) => epoch + 1);
  }, []);

  const [displayedSession, setDisplayedSession] = useState<Session | null>(
    null,
  );
  const subagentView = useSubagentView(displayedSession);

  const loadSessionRef = useRef<(sessionId: string) => void>(() => {});

  const { handleClear, handleReload, resetChatHistoryRef } = useChatHandlers(
    setShowIntroMessage,
    setStaticRefreshTrigger,
    resetTranscript,
  );

  const [diffContent, setDiffContent] = useState<string>("");

  const [statusMessage, setStatusMessage] = useState<string>("");

  const handleShowDiff = useCallback(
    (content: string) => {
      setDiffContent(content);
      navigateTo("diff");
    },
    [navigateTo],
  );

  const handleShowStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
    // Short confirmations can fade quickly; a message carrying a URL (the
    // /webui answer with its token) has to stay around long enough to copy.
    const ttl = message.length > 60 ? 20000 : 3000;
    setTimeout(() => {
      setStatusMessage((current) => (current === message ? "" : current));
    }, ttl);
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
    turnStatus,
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
  }, [isRemoteMode]);

  useMcpFailureNotice(services.mcp, setChatHistory);

  useEffect(() => {
    resetChatHistoryRef.current = resetChatHistory;
  }, [resetChatHistory]);

  const contextData = useContextPercentage({
    chatHistory,
    model: services.model?.model || undefined,
  });

  const contextReadout = useContextReadout(contextData);
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
      resetTranscript();
    },
    [closeCurrentScreen, setChatHistory, setShowIntroMessage, resetTranscript],
  );

  useEffect(() => {
    loadSessionRef.current = (sessionId: string) => {
      void handleSessionSelect(sessionId);
    };
  }, [handleSessionSelect]);

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

  const isInputDisabled =
    navState.currentScreen !== "chat" ||
    !!activePermissionRequest ||
    !!activeQuizQuestion;

  // Every streaming delta re-renders this component; the composer callbacks
  // are stable wrappers so the input row stays off that path. See
  // useComposerCallbacks.

  const isVerboseMode = useMemo(() => process.argv.includes("--verbose"), []);

  const isBashToolRunning = useBashToolRunning();

  const { rows } = useTerminalSize();
  const { following, scrollTop, onMetrics, onContentShift, jumpToBottom } =
    useChatViewport({
      isActive: navState.currentScreen === "chat",
    });
  const composer = useComposerCallbacks({
    handleUserMessage,
    handleInterrupt,
    handleFileAttached,
    handleEditMessage,
    handleToolPermissionResponse,
    handleQuizAnswer,
    handleReload,
    navigateTo,
    jumpToBottom,
  });

  const configuredChoice = useMemo<ThemeName | "auto">(() => {
    const configured =
      process.env.TNT_THEME ||
      readPersistedTheme() ||
      (services.config?.config as any)?.theme;
    return normalizeThemeChoice(
      configured === undefined ? undefined : String(configured),
    );
  }, [services.config?.config]);

  const [themeChoice, setThemeChoice] = useState<ThemeName | "auto">(
    configuredChoice,
  );
  const [previewChoice, setPreviewChoice] = useState<ThemeName | "auto" | null>(
    null,
  );
  const detected = detectedTerminalIsDark();

  const activeChoice = previewChoice ?? themeChoice;

  useEffect(() => {
    setThemeChoice(configuredChoice);
  }, [configuredChoice]);

  const currentTheme = themeOfChoice(activeChoice, detected);

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
          onContentShift={onContentShift}
          showScrollbar
        />

        <Composer
          contextReadout={contextReadout}
          sessionStatus={turnStatus}
          following={following}
          onJumpToLatest={jumpToBottom}
          statusMessage={statusMessage}
          isScreenActive={isScreenActive}
          services={services}
          handleModelSelect={handleModelSelect}
          handleSessionSelect={handleSessionSelect}
          handleExportSession={handleExportSession}
          handleReload={composer.reload}
          closeCurrentScreen={closeCurrentScreen}
          activePermissionRequest={activePermissionRequest}
          activeQuizQuestion={activeQuizQuestion}
          handleToolPermissionResponse={composer.toolPermission}
          handleQuizAnswer={composer.quizAnswer}
          handleUserMessage={composer.submit}
          isWaitingForResponse={isWaitingForResponse}
          isCompacting={isCompacting}
          queuedCount={queuedMessages?.length ?? 0}
          inputMode={inputMode}
          handleInterrupt={composer.interrupt}
          handleFileAttached={composer.fileAttached}
          isInputDisabled={isInputDisabled}
          wasInterrupted={wasInterrupted}
          isRemoteMode={isRemoteMode}
          remoteUrl={remoteUrl}
          diffContent={diffContent}
          chatHistory={chatHistory}
          handleEditMessage={composer.editMessage}
          onShowEditSelector={composer.openEditSelector}
          onShowAddModelSelector={composer.openAddModel}
          onOpenPalette={composer.openPalette}
          onOpenJobs={composer.openJobs}
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
