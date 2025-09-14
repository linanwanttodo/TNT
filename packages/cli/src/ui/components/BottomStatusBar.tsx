import type { ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../../i18n/index.js";
import {
  cacheStateText,
  getLastRequestCacheState,
} from "../../cache/lastRequestCacheState.js";
import { setExitMessageCallback, shouldShowExitMessage } from "../../index.js";
import { getSessionUsage } from "../../session/index.js";
import { getCacheHitRatio } from "../../utils/cacheRatio.js";
import { getGitBranch } from "../../utils/git.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import { UpdateNotification } from "../UpdateNotification.js";

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

/**
 * The cost line, or undefined when there is nothing to say. A request whose model
 * has no price still happened, so the line appears for it and names the count the
 * total cannot account for - a lone `$0.0000` would read as free.
 */
export function costLineText(
  totalCost: number | undefined,
  unpricedRequests: number,
): string | undefined {
  const cost = totalCost ?? 0;
  if (cost <= 0 && unpricedRequests <= 0) return undefined;

  const amount = `$${cost.toFixed(4)}`;
  return unpricedRequests > 0
    ? `${t("status.cost")} ${amount} (+${unpricedRequests} ${t("status.unpriced")})`
    : `${t("status.cost")} ${amount}`;
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

const SEPARATOR = "  ";

function joinParts(parts: React.ReactNode[]) {
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [<Text key={`sep-${index}`}>{SEPARATOR}</Text>, part],
  );
}

/**
 * Single line of composer metadata: workspace, git branch, context usage and
 * cache hit ratio on the left, model and reasoning depth on the right.
 */
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
  const workspaceName = remoteUrl ?? currentDirectory();
  const sessionUsage = getSessionUsage();
  const cacheHitRatio = getCacheHitRatio(sessionUsage);
  const compactionCost = sessionUsage?.compaction?.cost ?? 0;
  const costLine = costLineText(totalCost, sessionUsage?.unpricedRequests ?? 0);

  const leftParts: React.ReactNode[] = [];
  if (workspaceName) {
    leftParts.push(
      <Text key="workspace" color="dim" wrap="truncate-start">
        {`▸ ${workspaceName}`}
      </Text>,
    );
  }
  if (branch) {
    leftParts.push(
      <Text key="branch" color="dim" wrap="truncate-start">
        {`⊦ ${branch}`}
      </Text>,
    );
  }
  if (contextPercentage !== undefined) {
    leftParts.push(
      <Text key="context" color="dim">
        {`◷ ${t("status.context")} ${contextPercentage}%`}
      </Text>,
    );
  }
  if (cacheHitRatio !== undefined) {
    leftParts.push(
      <Text key="cache" color="dim">
        {`☰ ${t("status.cache")} ${cacheHitRatio}%`}
      </Text>,
    );
  }
  // The ratio above is a session average; this says what the last request did
  // with the prefix, and stays silent while the prefix held.
  const prefixState = cacheStateText(getLastRequestCacheState(), {
    prefix: t("status.prefix"),
    states: {
      full: "",
      passthrough: t("status.cacheExtended"),
      invalidated: t("status.cacheMoved"),
    },
  });
  if (prefixState) {
    leftParts.push(
      <Text key="prefix" color="dim">
        {`⟲ ${prefixState}`}
      </Text>,
    );
  }
  if (compactionCost > 0) {
    leftParts.push(
      <Text key="compaction" color="dim">
        {`${t("status.compact")} $${compactionCost.toFixed(4)}`}
      </Text>,
    );
  }
  if (hasImageInClipboard) {
    leftParts.push(
      <Text key="image" color="cyan">
        {t("status.image")}
      </Text>,
    );
  }
  if (isVerboseMode && costLine) {
    leftParts.push(
      <Text key="cost" color="dim">
        {costLine}
      </Text>,
    );
  }

  const rightParts: React.ReactNode[] = [];
  if (modelName) {
    rightParts.push(
      <Text key="model" color="white" wrap="truncate-end">
        {`◈ ${modelName}`}
      </Text>,
    );
  }
  if (modelName && thinkingDepth) {
    rightParts.push(
      <Text key="thinking" color="cyan">
        {`◐ ${t("status.think")}:${thinkingDepth}`}
      </Text>,
    );
  }

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box marginLeft={2} flexDirection="row" alignItems="center">
        {showingExitMessage ? (
          <Text color="dim" wrap="truncate-start">
            {t("status.exit")}
          </Text>
        ) : (
          joinParts(leftParts)
        )}
      </Box>
      <Box
        marginRight={2}
        marginLeft={2}
        flexDirection="row"
        alignItems="center"
      >
        {joinParts(rightParts)}
        <Box marginLeft={2}>
          <UpdateNotification isRemoteMode={isRemoteMode} />
        </Box>
      </Box>
    </Box>
  );
};
