import { Box, Text, type DOMElement } from "ink";
import React, { useRef } from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { theme } from "../theme/tokens.js";
import type { ThemeName } from "../theme/tokens.js";

import { BottomStatusBar } from "./BottomStatusBar.js";
import { ResourceDebugBar } from "./ResourceDebugBar.js";
import { ScreenContent } from "./ScreenContent.js";

interface ComposerProps {
  /** False while scrolled back: shows the jump hint and pauses the tail. */
  following: boolean;
  /** Returns the transcript to the live tail. */
  onJumpToLatest: () => void;
  statusMessage: string;
  isScreenActive: (screen: any) => boolean;
  services: any;
  handleConfigSelect: (config: any) => Promise<void>;
  handleModelSelect: (model: any) => Promise<void>;
  handleSessionSelect: (sessionId: string) => Promise<void>;
  handleExportSession: (sessionId: string) => Promise<void>;
  handleReload: () => Promise<void>;
  closeCurrentScreen: () => void;
  activePermissionRequest: any;
  activeQuizQuestion: any;
  handleToolPermissionResponse: (
    requestId: string,
    approved: boolean,
    createPolicy?: boolean,
    stopStream?: boolean,
    forSession?: boolean,
  ) => void;
  handleQuizAnswer: (requestId: string, answer: string) => void;
  handleUserMessage: (message: string, imageMap?: Map<string, Buffer>) => void;
  isWaitingForResponse: boolean;
  isCompacting: boolean;
  inputMode: boolean;
  handleInterrupt: () => void;
  handleFileAttached: (filePath: string, content: string) => void;
  isInputDisabled: boolean;
  wasInterrupted: boolean;
  isRemoteMode: boolean;
  remoteUrl: string | undefined;
  diffContent: string;
  chatHistory: ChatHistoryItem[];
  handleEditMessage: (messageIndex: number, newContent: string) => void;
  onShowEditSelector: () => void;
  onOpenPalette?: () => void;
  /** Previews a theme in place while the theme picker is open. */
  onPreviewTheme?: (themeName: ThemeName | "auto") => void;
  /** Rolls the preview back and closes the picker. */
  onCancelThemePreview?: () => void;
  /** Persists the choice and keeps it applied. */
  onSelectTheme?: (themeName: ThemeName | "auto") => void;
  subagentView: { parentSessionId: string; subagentType: string } | null;
  navState: any;
  navigateTo: (screen: any, data?: any) => void;
  contextPercentage: number;
  contextTokens: number | undefined;
  isVerboseMode: boolean;
  totalCost: number;
}

/**
 * The dock below the transcript: transient notices, the active screen
 * (usually the composer), the verbose debug bar and the status bar. It is the
 * bottom of the Ink frame, directly under the live transcript rows.
 */
export const Composer: React.FC<ComposerProps> = (props) => {
  const hintRef = useRef<DOMElement>(null);

  useClickRegion(hintRef, () => {
    if (!props.following) {
      props.onJumpToLatest();
    }
  });

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* The row is always allocated, so showing the hint cannot move the
          composer by a row and restart the layout. */}
      <Box ref={hintRef} justifyContent="center" height={1} flexShrink={0}>
        <Text color={theme.accent}>
          {props.following ? " " : t("ui.jumpToLatest")}
        </Text>
      </Box>

      {props.statusMessage && (
        <Box paddingX={1} paddingY={0}>
          <Text color="green">{props.statusMessage}</Text>
        </Box>
      )}

      <ScreenContent
        isScreenActive={props.isScreenActive}
        services={props.services}
        handleConfigSelect={props.handleConfigSelect}
        handleModelSelect={props.handleModelSelect}
        handleSessionSelect={props.handleSessionSelect}
        handleExportSession={props.handleExportSession}
        handleReload={props.handleReload}
        closeCurrentScreen={props.closeCurrentScreen}
        activePermissionRequest={props.activePermissionRequest}
        activeQuizQuestion={props.activeQuizQuestion}
        handleToolPermissionResponse={props.handleToolPermissionResponse}
        handleQuizAnswer={props.handleQuizAnswer}
        handleUserMessage={props.handleUserMessage}
        isWaitingForResponse={props.isWaitingForResponse}
        isCompacting={props.isCompacting}
        inputMode={props.inputMode}
        handleInterrupt={props.handleInterrupt}
        handleFileAttached={props.handleFileAttached}
        isInputDisabled={props.isInputDisabled}
        wasInterrupted={props.wasInterrupted}
        isRemoteMode={props.isRemoteMode}
        diffContent={props.diffContent}
        chatHistory={props.chatHistory}
        handleEditMessage={props.handleEditMessage}
        onShowEditSelector={props.onShowEditSelector}
        onOpenPalette={props.onOpenPalette}
        onPreviewTheme={props.onPreviewTheme}
        onCancelThemePreview={props.onCancelThemePreview}
        onSelectTheme={props.onSelectTheme}
        subagentView={props.subagentView}
      />

      {props.isVerboseMode && !props.isRemoteMode && (
        <ResourceDebugBar visible={props.navState.currentScreen === "chat"} />
      )}

      <BottomStatusBar
        remoteUrl={props.remoteUrl}
        isRemoteMode={props.isRemoteMode}
        services={props.services}
        navState={props.navState}
        navigateTo={props.navigateTo}
        closeCurrentScreen={props.closeCurrentScreen}
        contextPercentage={props.contextPercentage}
        contextTokens={props.contextTokens}
        isVerboseMode={props.isVerboseMode}
        totalCost={props.totalCost}
      />
    </Box>
  );
};
