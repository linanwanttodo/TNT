import type { ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  cacheStateText,
  getLastRequestCacheState,
} from "../../cache/lastRequestCacheState.js";
import { t } from "../../i18n/index.js";
import { setExitMessageCallback, shouldShowExitMessage } from "../../index.js";
import {
  getReasoningOverride,
  useReasoningOverride,
} from "../../session/reasoningOverride.js";
import { getGitBranch } from "../../utils/git.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { symbols } from "../symbols.js";
import { UpdateNotification } from "../UpdateNotification.js";
import { formatCostAmount } from "../utils/contextUsageLine.js";

import { JobsFooterSegment } from "./BackgroundTasksIndicator.js";

export interface BottomStatusBarProps {
  remoteUrl?: string;
  isRemoteMode: boolean;
  services: any;
  navState: any;
  navigateTo: (screen: NavigationScreen, data?: any) => void;
  closeCurrentScreen: () => void;
  /** Opens the background-jobs list. */
  onOpenJobs?: () => void;
  contextPercentage?: number;
  contextTokens?: number;
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

  const amount = formatCostAmount(cost);
  return unpricedRequests > 0
    ? `${t("status.cost")} ${amount} (+${unpricedRequests} ${t("status.unpriced")})`
    : `${t("status.cost")} ${amount}`;
}

function currentDirectory(): string {
  const parts = process.cwd().split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || process.cwd();
}

/**
 * The configured reasoning depth shown next to the model. A `/think` override
 * wins over the model's static default, so the row shows what the next request
 * will actually use; an unset depth is reported as "default" instead of hiding
 * the field.
 */
export function getThinkingDepth(model?: ModelConfig | null): string {
  const override = getReasoningOverride();
  if (override && override !== "default") {
    return override;
  }
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

/**
 * Rough width of the composed row, in terminal cells. It decides one thing:
 * whether the reasoning depth fits next to the usage figures. The count ignores
 * double-width glyphs, which errs towards dropping the depth earlier rather
 * than letting the row squeeze the cost out of view.
 */
export function estimateStatusRowWidth(input: {
  workspaceName: string;
  branch: string | null;
  prefixState: string | undefined;
  usageLine: string | undefined;
  modelName: string;
  shownModelName: string;
  thinkingText: string;
}): number {
  const workspace = input.workspaceName.length;
  const branch = input.branch ? 4 + input.branch.length : 0;
  const prefix = input.prefixState ? 3 + input.prefixState.length : 0;
  const usage = input.usageLine?.length ?? 0;
  const model = input.modelName ? 4 + input.shownModelName.length : 0;
  const thinking = input.thinkingText ? 2 + input.thinkingText.length : 0;

  // Two cells of margin either side, the gap before the usage group, and a
  // fixed reserve for the update badge on the right.
  return (
    2 + workspace + branch + prefix + 2 + usage + model + thinking + 10 + 2
  );
}

function joinParts(parts: React.ReactNode[]) {
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [<Text key={`sep-${index}`}>{SEPARATOR}</Text>, part],
  );
}

/**
 * Location and prefix state, in that order. Kept out of the component so the
 * render function stays under the project's complexity cap.
 */
function buildLeftParts(input: {
  workspaceName: string;
  branch: string | null;
  prefixState: string | undefined;
}): React.ReactNode[] {
  const parts: React.ReactNode[] = [];

  if (input.workspaceName) {
    parts.push(
      <Text key="workspace" color="dim" wrap="truncate-start">
        {`▸ ${input.workspaceName}`}
      </Text>,
    );
  }
  if (input.branch) {
    parts.push(
      <Text key="branch" color="dim" wrap="truncate-start">
        {`⊦ ${input.branch}`}
      </Text>,
    );
  }
  if (input.prefixState) {
    parts.push(
      <Text key="prefix" color="dim" wrap="truncate-end">
        {`⟲ ${input.prefixState}`}
      </Text>,
    );
  }
  return parts;
}

/**
 * The right-hand group: model, reasoning depth and the clickable background
 * jobs count. Kept out of the component so the render function stays under
 * the project's complexity cap.
 */
function buildRightParts(input: {
  modelName: string;
  shownModelName: string;
  thinkingText: string;
  showThinking: boolean;
  onOpenJobs?: () => void;
}): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  if (input.modelName) {
    parts.push(
      <Text key="model" color="white" wrap="truncate-end">
        {input.shownModelName}
      </Text>,
    );
  }
  if (input.showThinking) {
    parts.push(
      <Text key="thinking" color="cyan" wrap="truncate-end">
        {`${symbols().thinking} ${input.thinkingText}`}
      </Text>,
    );
  }
  if (input.onOpenJobs) {
    parts.push(<JobsFooterSegment key="jobs" onOpenJobs={input.onOpenJobs} />);
  }
  return parts;
}

/**
 * One row under the composer: where the session is, what it has spent, the
 * model, its reasoning depth and the update state. Everything shares the row
 * and the location side truncates first when the terminal is narrow.
 */
export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  remoteUrl,
  isRemoteMode,
  services,
  navState: _navState,
  navigateTo: _navigateTo,
  closeCurrentScreen: _closeCurrentScreen,
  onOpenJobs,
  contextPercentage: _contextPercentage,
  contextTokens: _contextTokens,
  isVerboseMode: _isVerboseMode,
  totalCost: _totalCost,
}) => {
  const [_refreshTrigger, setRefreshTrigger] = useState(0);
  // Re-renders the row when a /think command changes the session depth.
  useReasoningOverride();
  const { columns } = useTerminalSize();
  // Narrow terminals get a reduced row instead of an overflowing one: any line
  // wider than the terminal wraps in the terminal but not in Ink's layout, and
  // the next repaint lands on the wrong rows.
  const compact = columns < 100;

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

  // The cache ratio in the usage row is a session average; this says what the last
  // request did with the prefix, and stays silent while the prefix held.
  const prefixState = cacheStateText(getLastRequestCacheState(), {
    prefix: t("status.prefix"),
    states: {
      full: "",
      passthrough: t("status.cacheExtended"),
      invalidated: t("status.cacheMoved"),
    },
  });

  const leftParts = buildLeftParts({
    workspaceName,
    branch,
    prefixState,
  });

  const shownModelName =
    compact && modelName.length > 22
      ? `${modelName.slice(0, 21)}...`
      : modelName;

  const thinkingText =
    modelName && thinkingDepth && !compact
      ? `${t("status.think")}:${thinkingDepth}`
      : "";
  // The model, reasoning depth and workspace share one row. The depth is the
  // first field to go: it is explanatory, while the model name is the one a
  // reader is actually watching. Without this check the row silently squeezed
  // the model name instead.
  const showThinking =
    thinkingText.length > 0 &&
    estimateStatusRowWidth({
      workspaceName,
      branch,
      prefixState,
      usageLine: undefined,
      modelName,
      shownModelName,
      thinkingText,
    }) <= columns;

  const rightParts = buildRightParts({
    modelName,
    shownModelName,
    thinkingText,
    showThinking,
    onOpenJobs,
  });

  return (
    <Box
      width={columns}
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      overflow="hidden"
    >
      <Box
        marginLeft={2}
        flexDirection="row"
        alignItems="center"
        flexShrink={1}
        minWidth={0}
        overflow="hidden"
      >
        <Text wrap="truncate-end" color="dim">
          {showingExitMessage ? t("status.exit") : joinParts(leftParts)}
        </Text>
      </Box>
      <Box
        marginRight={2}
        marginLeft={2}
        flexDirection="row"
        alignItems="center"
        flexShrink={1}
        minWidth={0}
        overflow="hidden"
      >
        {joinParts(rightParts)}
        <Box marginLeft={2}>
          <UpdateNotification isRemoteMode={isRemoteMode} />
        </Box>
      </Box>
    </Box>
  );
};
