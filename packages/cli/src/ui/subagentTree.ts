import type { ChatHistoryItem } from "core/index.js";

import { claudeGlyphs } from "./symbols.js";

const RESULT_GUTTER = claudeGlyphs().resultGutter;

/**
 * What a delegated agent is doing, as the composer tree reports it.
 *
 * `background` is kept separate from `running` because a backgrounded agent
 * has already reported once: it still appears in the tree, but its tool and
 * token counters are deliberately hidden the way the reference does.
 */
export type SubagentTreeStatus = "running" | "done" | "failed" | "background";

export interface SubagentTreeEntry {
  id: string;
  agentType: string;
  description?: string;
  status: SubagentTreeStatus;
  /** Assistant tool calls in the child transcript; undefined while unknown. */
  toolUses?: number;
  /** Latest input plus cumulative output tokens; undefined while unknown. */
  tokens?: number;
  /** The tool the child is running now, when a surface can name it. */
  lastToolInfo?: string;
  /** The failure message when `status` is `failed`. */
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** A finished agent stays visible for this long when its turn ends first. */
export const DEFAULT_COLLAPSE_AFTER_MS = 5000;

/**
 * The `├─`/`└─` trunk before an agent row. The last sibling closes the branch,
 * so its continuation line has no vertical bar to carry.
 */
export function treeRowPrefix(isLast: boolean): string {
  return isLast ? "└─ " : "├─ ";
}

/**
 * The continuation under an agent row. Three leading columns put the result
 * gutter exactly under the first character of the badge; a non-last sibling
 * draws the trunk through them so the branch reads as one shape.
 */
export function treeContinuationPrefix(isLast: boolean): string {
  return isLast ? `   ${RESULT_GUTTER}  ` : `│  ${RESULT_GUTTER}  `;
}

export interface SubagentTreeView {
  visible: SubagentTreeEntry[];
  collapsed: SubagentTreeEntry[];
}

/**
 * Splits the agents into the rows still worth drawing and the ones that have
 * collapsed into the one-line summary. Running and background agents always
 * stay; a finished agent stays only while the turn is active and its finish
 * is recent.
 */
export function selectSubagentTreeEntries(
  entries: readonly SubagentTreeEntry[],
  options: {
    now: number;
    active: boolean;
    collapseAfterMs?: number;
  },
): SubagentTreeView {
  const collapseAfterMs = options.collapseAfterMs ?? DEFAULT_COLLAPSE_AFTER_MS;
  const visible: SubagentTreeEntry[] = [];
  const collapsed: SubagentTreeEntry[] = [];

  for (const entry of entries) {
    if (entry.status === "running" || entry.status === "background") {
      visible.push(entry);
      continue;
    }
    const finishedAt = entry.finishedAt ?? entry.startedAt;
    const recent = options.now - finishedAt < collapseAfterMs;
    if (options.active && recent) {
      visible.push(entry);
    } else {
      collapsed.push(entry);
    }
  }

  return { visible, collapsed };
}

export interface SubagentRowLabels {
  toolUses: (count: number) => string;
  tokens: (count: number) => string;
}

/**
 * The ` · N tool uses · N tokens` suffix. Empty when neither counter is
 * known, and empty for a backgrounded agent, which the reference renders
 * without counters.
 */
export function composeSubagentCounts(
  entry: SubagentTreeEntry,
  labels: SubagentRowLabels,
): string {
  if (entry.status === "background") {
    return "";
  }

  const parts: string[] = [];
  if (entry.toolUses !== undefined) {
    parts.push(labels.toolUses(entry.toolUses));
  }
  if (entry.tokens !== undefined) {
    parts.push(labels.tokens(entry.tokens));
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

/**
 * The row body after the trunk: badge text, optional parenthetical
 * description, then ` · N tool uses · N tokens` for the fields that are
 * known.
 */
export function composeSubagentRowText(
  entry: SubagentTreeEntry,
  labels: SubagentRowLabels,
): string {
  let text = entry.agentType;
  if (entry.description) {
    text += ` (${entry.description})`;
  }
  return text + composeSubagentCounts(entry, labels);
}

/**
 * Compact token counts: plain below a thousand, one decimal for thousands,
 * millions and billions, with a trailing `.0` dropped (`1k`, `1.2k`, `3m`).
 */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }
  if (count < 1000) {
    return String(Math.trunc(count));
  }

  const units: readonly [number, string][] = [
    [1_000_000_000, "b"],
    [1_000_000, "m"],
    [1_000, "k"],
  ];
  for (const [size, suffix] of units) {
    if (count >= size) {
      const value = (count / size).toFixed(1).replace(/\.0$/, "");
      return `${value}${suffix}`;
    }
  }
  return String(Math.trunc(count));
}

const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
  return WIDE_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

/** Terminal columns a string occupies, treating CJK and emoji as two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/**
 * Clips text to a column budget the way Ink's `truncate-end` does: no
 * ellipsis, and never half a double-width character. Row text goes through
 * this so a long agent name cannot push the counts off the line.
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (displayWidth(text) <= maxWidth) {
    return text;
  }

  let clipped = "";
  let width = 0;
  for (const char of text) {
    const charWidth = isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
    if (width + charWidth > maxWidth) {
      break;
    }
    clipped += char;
    width += charWidth;
  }
  return clipped;
}

export interface SubagentUsage {
  toolUses: number;
  /** Null when the child transcript carries no usage at all. */
  tokens: number | null;
}

/**
 * Counts a child run from its saved transcript. Each assistant turn carries
 * its tool calls; input tokens are cumulative context, so the latest prompt
 * report is added to the sum of the output reports, matching the reference's
 * progress counter.
 */
export function deriveSubagentUsage(
  history: readonly ChatHistoryItem[],
): SubagentUsage {
  let toolUses = 0;
  let latestPromptTokens: number | null = null;
  let completionTokens = 0;
  let sawUsage = false;

  for (const item of history) {
    const message = item.message;
    if (message.role !== "assistant") {
      continue;
    }
    toolUses += message.toolCalls?.length ?? item.toolCallStates?.length ?? 0;

    const usage = message.usage;
    if (usage) {
      sawUsage = true;
      latestPromptTokens = Number.isFinite(usage.promptTokens)
        ? usage.promptTokens
        : 0;
      completionTokens += Number.isFinite(usage.completionTokens)
        ? usage.completionTokens
        : 0;
    }
  }

  return {
    toolUses,
    tokens: sawUsage ? (latestPromptTokens ?? 0) + completionTokens : null,
  };
}
