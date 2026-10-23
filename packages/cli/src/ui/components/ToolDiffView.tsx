import { Box, Text } from "ink";
import React, { memo, useMemo } from "react";

import { useTheme, type Theme } from "../theme/tokens.js";

export interface ParsedDiffLine {
  type: "add" | "del" | "context" | "hunk" | "meta";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

const HUNK_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Checks whether the given string conforms to a unified diff or patch.
 */
export function isDiffContent(text: string): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }
  return (
    HUNK_REGEX.test(text) ||
    text.includes("\n@@ -") ||
    text.startsWith("diff --git ") ||
    text.includes("\ndiff --git ") ||
    (text.includes("\n--- ") && text.includes("\n+++ ")) ||
    (text.startsWith("--- ") && text.includes("\n+++ "))
  );
}

/**
 * Separates plain descriptive text from diff content if mixed together.
 */
export function separateDiffAndNotes(raw: string): {
  notes: string;
  diff: string;
} {
  if (!raw) {
    return { notes: "", diff: "" };
  }

  const lines = raw.split("\n");
  const diffStartIndex = lines.findIndex(
    (line) =>
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      HUNK_REGEX.test(line) ||
      line.startsWith("Index: "),
  );

  if (diffStartIndex <= 0) {
    return { notes: "", diff: raw };
  }

  const notes = lines.slice(0, diffStartIndex).join("\n").trim();
  const diff = lines.slice(diffStartIndex).join("\n").trim();
  return { notes, diff };
}

/**
 * Parses unified diff text into structured lines with line numbers.
 */
export function parseDiffLines(diffText: string): ParsedDiffLine[] {
  const lines = diffText.split("\n");
  const result: ParsedDiffLine[] = [];

  let currentOld = 0;
  let currentNew = 0;
  let inHunk = false;

  for (const rawLine of lines) {
    const hunkMatch = rawLine.match(HUNK_REGEX);
    if (hunkMatch) {
      currentOld = parseInt(hunkMatch[1], 10);
      currentNew = parseInt(hunkMatch[3], 10);
      inHunk = true;
      result.push({
        type: "hunk",
        content: rawLine,
      });
      continue;
    }

    if (!inHunk) {
      if (
        rawLine.startsWith("--- ") ||
        rawLine.startsWith("+++ ") ||
        rawLine.startsWith("diff --git") ||
        rawLine.startsWith("index ") ||
        rawLine.startsWith("new file mode") ||
        rawLine.startsWith("deleted file mode")
      ) {
        result.push({
          type: "meta",
          content: rawLine,
        });
        continue;
      }
    }

    if (rawLine.startsWith("+")) {
      result.push({
        type: "add",
        newLineNumber: currentNew,
        content: rawLine.substring(1),
      });
      currentNew++;
    } else if (rawLine.startsWith("-")) {
      result.push({
        type: "del",
        oldLineNumber: currentOld,
        content: rawLine.substring(1),
      });
      currentOld++;
    } else if (rawLine.startsWith(" ")) {
      result.push({
        type: "context",
        oldLineNumber: currentOld,
        newLineNumber: currentNew,
        content: rawLine.substring(1),
      });
      currentOld++;
      currentNew++;
    } else if (rawLine.startsWith("\\")) {
      result.push({
        type: "meta",
        content: rawLine,
      });
    } else if (inHunk && rawLine.trim() === "") {
      // Empty context line
      result.push({
        type: "context",
        oldLineNumber: currentOld,
        newLineNumber: currentNew,
        content: "",
      });
      currentOld++;
      currentNew++;
    }
  }

  return result;
}

/**
 * Counts additions and deletions across parsed diff lines.
 */
export function getDiffSummary(lines: ParsedDiffLine[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.type === "add") additions++;
    if (line.type === "del") deletions++;
  }

  return { additions, deletions };
}

export interface ToolDiffViewProps {
  diffContent: string;
  expanded: boolean;
  maxExpandedLines?: number;
  collapsedLines?: number;
  customTheme?: Theme;
}

/**
 * Dedicated diff renderer for tool execution output.
 * Features:
 * - Line numbers and diff glyphs (+ / -)
 * - Solid flat color backgrounds adhering to Tencent UI design guidelines
 * - Collapsible with tail preview
 * - Zero emoji, zero gradients, zero hover states
 */
export const ToolDiffView = memo<ToolDiffViewProps>(
  ({
    diffContent,
    expanded,
    maxExpandedLines = 60,
    collapsedLines = 4,
    customTheme,
  }) => {
    const activeTheme = customTheme ?? useTheme();
    const parsedLines = useMemo(
      () => parseDiffLines(diffContent),
      [diffContent],
    );

    // Filter displayable rows (exclude file header metadata for compactness)
    const displayRows = useMemo(() => {
      return parsedLines.filter((l) => l.type !== "meta");
    }, [parsedLines]);

    const total = displayRows.length;

    const visibleRows = useMemo(() => {
      if (total === 0) return [];

      if (expanded) {
        return displayRows.slice(0, maxExpandedLines);
      }

      if (total <= collapsedLines) {
        return displayRows;
      }

      return displayRows.slice(-collapsedLines);
    }, [displayRows, expanded, total, maxExpandedLines, collapsedLines]);

    const hiddenAbove = expanded ? 0 : Math.max(0, total - collapsedLines);
    const hiddenBelow = expanded ? Math.max(0, total - maxExpandedLines) : 0;

    const toggleHint =
      hiddenAbove > 0
        ? `... (${hiddenAbove} earlier ${
            hiddenAbove === 1 ? "line" : "lines"
          }, click to expand)`
        : expanded
          ? "click to collapse"
          : "";

    if (total === 0) {
      return (
        <Box flexDirection="column">
          <Text color={activeTheme.tool.hint}>No visible changes.</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" width="100%">
        {hiddenAbove > 0 ? (
          <Text color={activeTheme.tool.hint}>{toggleHint}</Text>
        ) : null}

        {visibleRows.map((line, idx) => {
          const rowKey = `diff-row-${idx}-${line.type}-${line.newLineNumber ?? line.oldLineNumber ?? ""}`;
          let gutter = "";
          let marker = " ";
          let bg: string | undefined = undefined;
          let textColor = activeTheme.diff.contextText;

          if (line.type === "add") {
            gutter = (line.newLineNumber ?? "").toString();
            marker = "+";
            bg = activeTheme.diff.addBackground;
            textColor = activeTheme.diff.addText;
          } else if (line.type === "del") {
            gutter = (line.oldLineNumber ?? "").toString();
            marker = "-";
            bg = activeTheme.diff.delBackground;
            textColor = activeTheme.diff.delText;
          } else if (line.type === "hunk") {
            gutter = "@@";
            marker = " ";
            bg = activeTheme.diff.hunkBackground;
            textColor = activeTheme.diff.hunkText;
          } else {
            gutter = (
              line.newLineNumber ??
              line.oldLineNumber ??
              ""
            ).toString();
            marker = " ";
            textColor = activeTheme.diff.contextText;
          }

          return (
            <Box
              key={rowKey}
              flexDirection="row"
              width="100%"
              backgroundColor={bg}
            >
              <Box width={5} flexShrink={0}>
                <Text color={activeTheme.diff.gutterText}>
                  {gutter.padStart(4)}
                </Text>
              </Box>
              <Box width={2} flexShrink={0}>
                <Text color={textColor} bold={line.type !== "context"}>
                  {marker}
                </Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={textColor}>{line.content}</Text>
              </Box>
            </Box>
          );
        })}

        {hiddenBelow > 0 ? (
          <Text color={activeTheme.tool.hint}>
            ... ({hiddenBelow} more lines)
          </Text>
        ) : null}

        {hiddenAbove === 0 && expanded ? (
          <Text color={activeTheme.tool.hint}>{toggleHint}</Text>
        ) : null}
      </Box>
    );
  },
);

ToolDiffView.displayName = "ToolDiffView";
