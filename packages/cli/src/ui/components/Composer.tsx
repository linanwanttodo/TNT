import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";

import { BottomStatusBar } from "./BottomStatusBar.js";
import { ResourceDebugBar } from "./ResourceDebugBar.js";
import { ScreenContent } from "./ScreenContent.js";

interface ComposerProps {
  dockRef: React.RefObject<DOMElement | null>;
  /** False while scrolled back: shows the jump hint and pauses the tail. */
  following: boolean;
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
  onImageInClipboardChange: (hasImage: boolean) => void;
  diffContent: string;
  chatHistory: ChatHistoryItem[];
  handleEditMessage: (messageIndex: number, newContent: string) => void;
  onShowEditSelector: () => void;
  subagentView: { parentSessionId: string; subagentType: string } | null;
  navState: any;
  navigateTo: (screen: any, data?: any) => void;
  contextPercentage: number;
  contextTokens: number | undefined;
  hasImageInClipboard: boolean;
  isVerboseMode: boolean;
  totalCost: number;
}

/**
 * The fixed dock below the transcript: the jump hint, transient notices, the
 * active screen (usually the composer), the verbose debug bar and the two-row
 * status bar.
 */
export const Composer: React.FC<ComposerProps> = (props) => {
  return (
    <Box ref={props.dockRef} flexDirection="column" flexShrink={0}>
      {!props.following && (
        <Box justifyContent="center" flexShrink={0}>
          <Text color="cyan">{t("ui.jumpToLatest")}</Text>
        </Box>
      )}

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
        onImageInClipboardChange={props.onImageInClipboardChange}
        diffContent={props.diffContent}
        chatHistory={props.chatHistory}
        handleEditMessage={props.handleEditMessage}
        onShowEditSelector={props.onShowEditSelector}
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
        hasImageInClipboard={props.hasImageInClipboard}
        isVerboseMode={props.isVerboseMode}
        totalCost={props.totalCost}
      />
    </Box>
  );
};
