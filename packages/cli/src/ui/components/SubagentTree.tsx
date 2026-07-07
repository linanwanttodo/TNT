import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../../i18n/index.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  composeSubagentCounts,
  composeSubagentRowText,
  DEFAULT_COLLAPSE_AFTER_MS,
  displayWidth,
  formatTokenCount,
  selectSubagentTreeEntries,
  treeContinuationPrefix,
  treeRowPrefix,
  truncateToWidth,
  type SubagentRowLabels,
  type SubagentTreeEntry,
} from "../subagentTree.js";
import { useTheme } from "../theme/tokens.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

/** paddingLeft(3) + `├─ ` (3), the columns before the badge. */
const GUTTER_COLUMNS = 6;
/** The continuation prefix is three columns wider than the tree prefix. */
const CONTINUATION_INDENT = 3;

export interface SubagentTreeProps {
  entries: readonly SubagentTreeEntry[];
  /**
   * Whether the parent turn still runs. Once it ends, finished agents fold
   * into the one-line summary even if they finished a moment ago.
   */
  active?: boolean;
  collapseAfterMs?: number;
  /** Injectable clock for tests; unset means live `Date.now()`. */
  now?: () => number;
  /** Injectable width for tests; unset means the terminal's columns. */
  columns?: number;
}

function rowLabels(): SubagentRowLabels {
  return {
    toolUses: (count) =>
      t(count === 1 ? "subagent.tree.toolUseOne" : "subagent.tree.toolUses", {
        count,
      }),
    tokens: (count) =>
      t("subagent.tree.tokens", { count: formatTokenCount(count) }),
  };
}

/** The text after the result gutter, one line per agent. */
export function subagentStatusText(entry: SubagentTreeEntry): string {
  switch (entry.status) {
    case "running":
      return entry.lastToolInfo ?? t("subagent.tree.initializing");
    case "done":
      return t("subagent.tree.done");
    case "failed":
      return entry.error
        ? `${t("subagent.tree.failed")}: ${entry.error}`
        : t("subagent.tree.failed");
    case "background":
      return t("subagent.tree.background");
  }
}

/** The one line that replaces folded agents. */
export function subagentSummaryText(
  collapsed: readonly SubagentTreeEntry[],
): string {
  const failed = collapsed.filter((entry) => entry.status === "failed").length;
  const base =
    collapsed.length === 1
      ? t("subagent.tree.finishedOne")
      : t("subagent.tree.finishedMany", { count: collapsed.length });
  return failed > 0
    ? `${base} · ${t("subagent.tree.failedCount", { count: failed })}`
    : base;
}

/**
 * The tree of delegated agents under the composer, drawn the way the
 * reference draws it: `├─`/`└─` per sibling, a type badge, the tool and token
 * counts that are known, and a result-gutter continuation carrying the run's
 * status.
 * Finished agents fold into a summary once the turn ends or their finish ages
 * out; their full transcripts stay in the breadcrumb and selector.
 */
const SubagentTree: React.FC<SubagentTreeProps> = ({
  entries,
  active = true,
  collapseAfterMs,
  now,
  columns,
}) => {
  const theme = useTheme();
  const terminal = useTerminalSize();
  const [, forceTick] = useState(0);
  const width = columns ?? terminal.columns;
  const available = Math.max(1, width - GUTTER_COLUMNS);
  const statusWidth = Math.max(1, available - CONTINUATION_INDENT);
  const currentTime = now ? now() : Date.now();
  const collapseAfter = collapseAfterMs ?? DEFAULT_COLLAPSE_AFTER_MS;
  // Only tick while a visible finish is still inside its window; once every
  // finished row has folded, the interval stops instead of re-rendering an
  // idle tree forever.
  const awaitingCollapse = entries.some((entry) => {
    if (entry.status !== "done" && entry.status !== "failed") {
      return false;
    }
    const finishedAt = entry.finishedAt ?? entry.startedAt;
    return currentTime - finishedAt < collapseAfter;
  });

  useEffect(() => {
    if (!active || !awaitingCollapse || now) {
      return;
    }
    const timer = setInterval(() => forceTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [active, awaitingCollapse, now]);

  if (entries.length === 0) {
    return null;
  }

  const { visible, collapsed } = selectSubagentTreeEntries(entries, {
    now: currentTime,
    active,
    collapseAfterMs,
  });

  if (visible.length === 0 && collapsed.length === 0) {
    return null;
  }

  const labels = rowLabels();

  return (
    <Box flexDirection="column" flexShrink={0}>
      {visible.map((entry, index) => {
        const isLast = index === visible.length - 1;
        const plainText = sanitizeTerminalText(
          composeSubagentRowText(entry, labels),
        );
        const overflow = displayWidth(plainText) > available;
        const status = truncateToWidth(
          sanitizeTerminalText(subagentStatusText(entry)),
          statusWidth,
        );
        const counts = composeSubagentCounts(entry, labels);

        return (
          <Box key={entry.id} flexDirection="column">
            <Box paddingLeft={3}>
              <Text dimColor>{treeRowPrefix(isLast)}</Text>
              {overflow ? (
                <Text wrap="truncate-end" dimColor={entry.status !== "running"}>
                  {truncateToWidth(plainText, available)}
                </Text>
              ) : (
                <Text wrap="truncate-end">
                  <Text
                    bold
                    backgroundColor={theme.claude}
                    color={theme.text.inverse}
                  >
                    {sanitizeTerminalText(entry.agentType)}
                  </Text>
                  {entry.description ? (
                    <Text dimColor>
                      {` (${sanitizeTerminalText(entry.description)})`}
                    </Text>
                  ) : null}
                  {counts ? <Text dimColor>{counts}</Text> : null}
                </Text>
              )}
            </Box>
            <Box paddingLeft={3}>
              <Text dimColor>{treeContinuationPrefix(isLast)}</Text>
              <Text dimColor wrap="truncate-end">
                {status}
              </Text>
            </Box>
          </Box>
        );
      })}
      {collapsed.length > 0 ? (
        <Box paddingLeft={3}>
          <Text dimColor wrap="truncate-end">
            {truncateToWidth(subagentSummaryText(collapsed), available)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

export { SubagentTree };
