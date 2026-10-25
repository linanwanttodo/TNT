import React from "react";

import { ChatScreenContent } from "../components/ChatScreenContent.js";
import type { ScreenContentProps } from "../components/ScreenContent.js";
import { SessionSelectorWithLoading } from "../components/SessionSelectorWithLoading.js";
import { ThemeSelector } from "../components/ThemeSelector.js";
import { ConfigSelector } from "../ConfigSelector.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import { DiffViewer } from "../DiffViewer.js";
import { EditMessageSelector } from "../EditMessageSelector.js";
import { JobsSelector } from "../JobsSelector.js";
import { MCPMarketplace } from "../MCPMarketplace.js";
import { MCPSelector } from "../MCPSelector.js";
import { ModelSelector } from "../ModelSelector.js";
import { UpdateSelector } from "../UpdateSelector.js";

/**
 * The screens the navigation context can resolve, as a table rather than a
 * chain of identity checks. Adding a screen means adding one entry here; the
 * dispatcher in `ScreenContent` does not grow.
 */
export interface ScreenDefinition {
  id: NavigationScreen;
  render: (props: ScreenContentProps) => React.ReactElement;
}

export const SCREENS: readonly ScreenDefinition[] = [
  {
    id: "config",
    render: (props) => (
      <ConfigSelector
        onSelect={props.handleConfigSelect}
        onCancel={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "mcp",
    render: (props) => <MCPSelector onCancel={props.closeCurrentScreen} />,
  },
  {
    id: "mcpMarket",
    render: (props) => <MCPMarketplace onCancel={props.closeCurrentScreen} />,
  },
  {
    id: "update",
    render: (props) => <UpdateSelector onCancel={props.closeCurrentScreen} />,
  },
  {
    id: "theme",
    render: (props) => (
      <ThemeSelector
        onPreview={props.onPreviewTheme ?? (() => {})}
        onCancel={props.onCancelThemePreview ?? props.closeCurrentScreen}
        onSelect={props.onSelectTheme ?? (() => {})}
      />
    ),
  },
  {
    id: "model",
    render: (props) => (
      <ModelSelector
        onSelect={props.handleModelSelect}
        onCancel={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "session",
    render: (props) => (
      <SessionSelectorWithLoading
        onSelect={props.handleSessionSelect}
        onExit={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "export",
    render: (props) => (
      <SessionSelectorWithLoading
        onSelect={props.handleExportSession}
        onExit={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "subagents",
    render: (props) => (
      <SessionSelectorWithLoading
        source="subagents"
        parentSessionId={props.subagentView?.parentSessionId}
        onSelect={props.handleSessionSelect}
        onExit={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "jobs",
    render: (props) => <JobsSelector onCancel={props.closeCurrentScreen} />,
  },
  {
    id: "diff",
    render: (props) => (
      <DiffViewer
        diffContent={props.diffContent || ""}
        onClose={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "edit",
    render: (props) => (
      <EditMessageSelector
        chatHistory={props.chatHistory ?? []}
        onEdit={(messageIndex, newContent) => {
          props.handleEditMessage?.(messageIndex, newContent);
          props.closeCurrentScreen();
        }}
        onExit={props.closeCurrentScreen}
      />
    ),
  },
  {
    id: "chat",
    render: (props) => (
      <ChatScreenContent
        activePermissionRequest={props.activePermissionRequest}
        activeQuizQuestion={props.activeQuizQuestion}
        handleToolPermissionResponse={props.handleToolPermissionResponse}
        handleQuizAnswer={props.handleQuizAnswer}
        handleUserMessage={props.handleUserMessage}
        isWaitingForResponse={props.isWaitingForResponse}
        isCompacting={props.isCompacting}
        inputMode={props.inputMode}
        handleInterrupt={props.handleInterrupt}
        assistant={props.services.config?.config || undefined}
        wasInterrupted={props.wasInterrupted ?? false}
        handleFileAttached={props.handleFileAttached}
        isInputDisabled={props.isInputDisabled}
        isRemoteMode={props.isRemoteMode}
        onShowEditSelector={props.onShowEditSelector}
        subagentView={props.subagentView}
      />
    ),
  },
];
