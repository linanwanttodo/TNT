import type { ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  cacheStateText,
  getLastRequestCacheState,
} from "../../cache/lastRequestCacheState.js";
import { t } from "../../i18n/index.js";
import { setExitMessageCallback, shouldShowExitMessage } from "../../index.js";
import { getSessionUsage } from "../../session/index.js";
import { getCacheHitRatio } from "../../utils/cacheRatio.js";
import { getGitBranch } from "../../utils/git.js";
import { getModelContextLimit } from "../../utils/tokenizer.js";
import type { NavigationScreen } from "../context/NavigationContext.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { symbols } from "../symbols.js";
import { UpdateNotification } from "../UpdateNotification.js";
import {
  contextUsageLine,
  formatCostAmount,
} from "../utils/contextUsageLine.js";

export interface BottomStatusBarProps {
  remoteUrl?: string;
  isRemoteMode: boolean;
  services: any;
  navState: any;
  navigateTo: (screen: NavigationScreen, data?: any) => void;
  closeCurrentScreen: () => void;
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

/**
 * How many of this session's requests the cache ratio above is made of. The
 * read lives here because `getSessionUsage` answers nothing before the first
 * request, and the row already carries enough branches of its own.
 */
function usageCoverageOf(sessionUsage?: {
  reportedUsageRequests?: number;
  unreportedUsageRequests?: number;
}): { reported: number; sent: number } | undefined {
  const reported = sessionUsage?.reportedUsageRequests ?? 0;
  const sent = reported + (sessionUsage?.unreportedUsageRequests ?? 0);
  return sent > 0 ? { reported, sent } : undefined;
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
 * The spend figures at the end of the left group: the compaction cost when a
 * compaction ran, then context/cache/output/cost. Renders nothing when there
 * is nothing to say.
 */
const UsageSegment: React.FC<{
  compactionCost: number;
  usageLine?: string;
}> = ({ compactionCost, usageLine }) => {
  if (compactionCost <= 0 && !usageLine) {
    return null;
  }

  return (
    <Box
      flexShrink={1}
      minWidth={0}
      overflow="hidden"
      flexDirection="row"
      alignItems="center"
      marginLeft={2}
    >
      {compactionCost > 0 && (
        <Text color="dim" wrap="truncate-end">
          {`${t("status.compact")} $${compactionCost.toFixed(4)}`}
          {usageLine ? SEPARATOR : ""}
        </Text>
      )}
      {usageLine && (
        <Text color="dim" wrap="truncate-end">
          {usageLine}
        </Text>
      )}
    </Box>
  );
};

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
  contextPercentage,
  contextTokens,
  isVerboseMode,
  totalCost,
}) => {
  const [_refreshTrigger, setRefreshTrigger] = useState(0);
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
  const sessionUsage = getSessionUsage();
  const cacheHitRatio = getCacheHitRatio(sessionUsage);
  const compactionCost = sessionUsage?.compaction?.cost ?? 0;

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

  const fullUsageLine = contextUsageLine({
    usedTokens: contextTokens,
    limitTokens: model ? getModelContextLimit(model) : undefined,
    contextPercentage,
    cacheHitRatio,
    // Not verbose-only, unlike the price count: this says what the always-shown
    // ratio left out, so hiding it would leave the number looking complete.
    usageCoverage: usageCoverageOf(sessionUsage),
    outputTokens: sessionUsage?.completionTokens,
    costGroup: costLineText(
      totalCost,
      isVerboseMode ? (sessionUsage?.unpricedRequests ?? 0) : 0,
    ),
    labels: {
      ctx: t("status.context"),
      cache: t("status.cache"),
      out: t("status.output"),
    },
  });

  const usageLine = compact ? fullUsageLine?.split(" · ")[0] : fullUsageLine;

  const thinkingText =
    modelName && thinkingDepth && !compact
      ? `${t("status.think")}:${thinkingDepth}`
      : "";
  // The model, reasoning depth, workspace and usage share one row. The depth
  // is the first field to go: it is explanatory, while the usage figures and
  // the model name are the ones a reader is actually watching. Without this
  // check the row silently squeezed the cost and the model name instead.
  const showThinking =
    thinkingText.length > 0 &&
    estimateStatusRowWidth({
      workspaceName,
      branch,
      prefixState,
      usageLine: fullUsageLine,
      modelName,
      shownModelName,
      thinkingText,
    }) <= columns;

  const rightParts: React.ReactNode[] = [];
  if (modelName) {
    rightParts.push(
      <Text key="model" color="white" wrap="truncate-end">
        {`◈ ${shownModelName}`}
      </Text>,
    );
  }
  if (showThinking) {
    rightParts.push(
      <Text key="thinking" color="cyan" wrap="truncate-end">
        {`${symbols().thinking} ${thinkingText}`}
      </Text>,
    );
  }

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
      {!showingExitMessage && (
        <UsageSegment
          compactionCost={compact ? 0 : compactionCost}
          usageLine={usageLine}
        />
      )}
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
