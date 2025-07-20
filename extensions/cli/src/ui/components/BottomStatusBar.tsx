import type { ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { setExitMessageCallback, shouldShowExitMessage } from "../../index.js";
import { t } from "../../i18n/index.js";
import { getGitBranch } from "../../util/git.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import { UpdateNotification } from "../UpdateNotification.js";

import { ContextPercentageDisplay } from "./ContextPercentageDisplay.js";
import { ResponsiveRepoDisplay } from "./ResponsiveRepoDisplay.js";

export interface BottomStatusBarProps {
  remoteUrl?: string;
  isRemoteMode: boolean;
  services: any;
  navState: any;
  navigateTo: (screen: NavigationScreen, data?: any) => void;
  closeCurrentScreen: () => void;
  contextPercentage?: number;
  hasImageInClipboard?: boolean;
  isVerboseMode?: boolean;
  totalCost?: number;
}

function currentDirectory(): string {
  const parts = process.cwd().split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || process.cwd();
}

/**
 * The configured reasoning depth shown next to the model. An unset depth is
 * reported as "default" instead of hiding the field, so the row always
 * explains how much thinking the model will do.
 */
export function getThinkingDepth(model?: ModelConfig | null): string {
  if (!model) {
    return "";
  }
  const options = model.defaultCompletionOptions;
  if (options?.reasoning === false) {
    return "off";
  }
  return options?.reasoningEffort ?? "default";
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  remoteUrl,
  isRemoteMode,
  services,
  navState: _navState,
  navigateTo: _navigateTo,
  closeCurrentScreen: _closeCurrentScreen,
  contextPercentage,
  hasImageInClipboard,
  isVerboseMode,
  totalCost,
}) => {
  const [_refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    setExitMessageCallback(() => {
      setRefreshTrigger((prev) => prev + 1);
    });
  }, []);

  const showingExitMessage = shouldShowExitMessage();
  const model = services?.model?.model as ModelConfig | null | undefined;
  const modelName = model?.name || model?.model || "";
  const thinkingDepth = getThinkingDepth(model);
  const branch = isRemoteMode ? null : getGitBranch();
  const workspace = `${remoteUrl ?? currentDirectory()}${
    branch ? ` ⊦${branch}` : ""
  }`;

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box marginLeft={2} flexDirection="row" alignItems="center">
        {showingExitMessage ? (
          <Text color="dim" wrap="truncate-start">
            {t("status.exit")}
          </Text>
        ) : (
          <React.Fragment>
            {isRemoteMode && remoteUrl ? (
              <ResponsiveRepoDisplay remoteUrl={remoteUrl} />
            ) : (
              <Text color="dim" wrap="truncate-start">
                {workspace}
              </Text>
            )}
            {modelName ? (
              <React.Fragment>
                <Text color="dim">{"  "}</Text>
                <Text color="white" wrap="truncate-start">
                  {modelName}
                </Text>
              </React.Fragment>
            ) : null}
            {modelName && thinkingDepth ? (
              <React.Fragment>
                <Text color="dim">{" · "}</Text>
                <Text color="cyan">{`${t("status.think")}:${thinkingDepth}`}</Text>
              </React.Fragment>
            ) : null}
            {contextPercentage !== undefined ? (
              <React.Fragment>
                <Text color="dim">{" · "}</Text>
                <ContextPercentageDisplay percentage={contextPercentage} />
              </React.Fragment>
            ) : null}
            {hasImageInClipboard ? (
              <Text color="cyan">{` · ${t("status.image")}`}</Text>
            ) : null}
          </React.Fragment>
        )}
        {isVerboseMode && totalCost !== undefined && totalCost > 0 ? (
          <React.Fragment>
            <Text color="dim">{" · "}</Text>
            <Text color="dim">{`${t("status.cost")}: $${totalCost.toFixed(4)}`}</Text>
          </React.Fragment>
        ) : null}
      </Box>
      <Box marginRight={2} marginLeft={2}>
        <UpdateNotification isRemoteMode={isRemoteMode} />
      </Box>
    </Box>
  );
};
