import React from "react";

import { UpdateServiceState } from "src/services/types.js";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import type {
  ActivePermissionRequest,
  ActiveQuizQuestion,
} from "../hooks/useChat.types.js";
import { SCREENS } from "../screens/registry.js";
import type { ThemeName } from "../theme/tokens.js";
import type { ConfigOption, ModelOption } from "../types/selectorTypes.js";

export interface ScreenContentProps {
  isScreenActive: (screen: NavigationScreen) => boolean;
  services: any;
  handleConfigSelect: (config: ConfigOption) => Promise<void>;
  handleModelSelect: (model: ModelOption) => Promise<void>;
  handleSessionSelect: (sessionId: string) => Promise<void>;
  handleExportSession: (sessionId: string) => Promise<void>;
  handleReload: () => Promise<void>;
  closeCurrentScreen: () => void;
  activePermissionRequest: ActivePermissionRequest | null;
  activeQuizQuestion: ActiveQuizQuestion | null;
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
  wasInterrupted?: boolean;
  isRemoteMode: boolean;
  diffContent?: string;
  chatHistory?: ChatHistoryItem[];
  handleEditMessage?: (messageIndex: number, newContent: string) => void;
  onShowEditSelector?: () => void;
  /** Opens the Ctrl+P command palette. */
  onOpenPalette?: () => void;
  /** Opens the background-jobs list. */
  onOpenJobs?: () => void;
  /** Previews a theme in place while the theme picker is open. */
  onPreviewTheme?: (themeName: ThemeName | "auto") => void;
  /** Rolls the preview back and closes the picker. */
  onCancelThemePreview?: () => void;
  /** Persists the choice and keeps it applied. */
  onSelectTheme?: (themeName: ThemeName | "auto") => void;
  /** Set while a delegated transcript is open, so it can be labelled. */
  subagentView?: { parentSessionId: string; subagentType: string } | null;
}

/**
 * Only a replacement in progress hides the dock. A version check used to hide
 * it too, which kept the composer off screen for as long as the network probe
 * ran - first paint looked fine while the input box was simply missing.
 */
export function hideScreenContent(state?: UpdateServiceState) {
  return !!(
    state?.isAutoUpdate &&
    (state?.status === "updating" || state?.status === "updated")
  );
}

/**
 * The active screen is one lookup in the registry. The branch order that used
 * to live here made every new screen touch this file; the registry now owns
 * that list.
 */
export const ScreenContent: React.FC<ScreenContentProps> = (props) => {
  if (hideScreenContent(props.services.update)) {
    return null;
  }

  const screen = SCREENS.find((entry) => props.isScreenActive(entry.id));
  return screen ? screen.render(props) : null;
};
