import { diffWordsWithSpace, Change } from "diff";
import { Box, Text } from "ink";
import React, { useMemo } from "react";

import {
  diffFilePath,
  highlightCode,
  languageFromFileName,
} from "./SyntaxHighlighter.js";
import { useTheme, type Theme } from "./theme/tokens.js";

export interface DiffLine {
  type: "add" | "del" | "context" | "hunk" | "other";
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split("\n");
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentNewLine = parseInt(hunkMatch[2], 10);
      inHunk = true;
      result.push({ type: "hunk", content: line });
      currentOldLine--;
      currentNewLine--;
      continue;
    }
    if (!inHunk) {
      if (
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("diff --git") ||
        line.startsWith("index ")
      )
        continue;
      continue;
    }
    if (line.startsWith("+")) {
      currentNewLine++;
      result.push({
        type: "add",
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith("-")) {
      currentOldLine++;
      result.push({
        type: "del",
        oldLine: currentOldLine,
        content: line.substring(1),
      });
    } else if (line.startsWith(" ")) {
      currentOldLine++;
      currentNewLine++;
      result.push({
        type: "context",
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith("\\")) {
      result.push({ type: "other", content: line });
    }
  }
  return result;
}

function useWordLevelDiff(oldContent: string, newContent: string) {
  return useMemo(() => {
    return diffWordsWithSpace(oldContent, newContent);
  }, [oldContent, newContent]);
}

function renderWordLevelContent(
  changes: Change[],
  showType: "removed" | "added",
  activeTheme: Theme,
): React.ReactNode {
  const segments: React.ReactNode[] = [];

  changes.forEach((change, index) => {
    if (showType === "removed") {
      if (change.removed) {
        segments.push(
          <Text
            key={index}
            backgroundColor={activeTheme.diff.delBackground}
            color={activeTheme.diff.delText}
            bold
          >
            {change.value}
          </Text>,
        );
      } else if (!change.added) {
        segments.push(change.value);
      }
    } else {
      if (change.added) {
        segments.push(
          <Text
            key={index}
            backgroundColor={activeTheme.diff.addBackground}
            color={activeTheme.diff.addText}
            bold
          >
            {change.value}
          </Text>,
        );
      } else if (!change.removed) {
        segments.push(change.value);
      }
    }
  });

  return <>{segments}</>;
}

const WordLevelDiffGroup: React.FC<{
  groupIndex: number;
  delLines: DiffLine[];
  addLines: DiffLine[];
  activeTheme: Theme;
}> = ({ groupIndex, delLines, addLines, activeTheme }) => {
  const oldContent = delLines.map((l) => l.content).join("\n");
  const newContent = addLines.map((l) => l.content).join("\n");
  const changes = useWordLevelDiff(oldContent, newContent);

  return (
    <Box key={`group-${groupIndex}`} flexDirection="column">
      <Box flexDirection="row">
        <Text color={activeTheme.diff.gutterText}>
          {(delLines[0]?.oldLine ?? "").toString().padEnd(4)}{" "}
        </Text>
        <Text
          backgroundColor={activeTheme.diff.delBackground}
          color={activeTheme.diff.delText}
        >
          -{" "}
        </Text>
        <Text
          backgroundColor={activeTheme.diff.delBackground}
          color={activeTheme.diff.delText}
        >
          {renderWordLevelContent(changes, "removed", activeTheme)}
        </Text>
      </Box>
      <Box flexDirection="row">
        <Text color={activeTheme.diff.gutterText}>
          {(addLines[0]?.newLine ?? "").toString().padEnd(4)}{" "}
        </Text>
        <Text
          backgroundColor={activeTheme.diff.addBackground}
          color={activeTheme.diff.addText}
        >
          +{" "}
        </Text>
        <Text
          backgroundColor={activeTheme.diff.addBackground}
          color={activeTheme.diff.addText}
        >
          {renderWordLevelContent(changes, "added", activeTheme)}
        </Text>
      </Box>
    </Box>
  );
};

// Helper function to process a group of lines
function processGroup(
  group: DiffLine[],
): Array<{ type: "group" | "single"; lines: DiffLine[] }> {
  if (group.length <= 1) {
    return [{ type: "single", lines: group }];
  }

  const delLines = group.filter((l) => l.type === "del");
  const addLines = group.filter((l) => l.type === "add");

  // Only do word-level diff if we have both deletions and additions
  if (delLines.length > 0 && addLines.length > 0) {
    return [{ type: "group", lines: group }];
  }

  // Single type, treat as individual lines
  return group.map((l) => ({ type: "single" as const, lines: [l] }));
}

export const ColoredDiff: React.FC<{
  diffContent: string;
  /** Rows to render; the viewer passes its viewport height so it can scroll. */
  maxLines?: number;
  /** First displayable row to render. */
  offset?: number;
  /** The full-screen viewer prints its own position line. */
  showFooter?: boolean;
}> = ({ diffContent, maxLines = 16, offset = 0, showFooter = true }) => {
  const activeTheme = useTheme();
  const parsedLines = parseDiffWithLineNumbers(diffContent);
  const language = useMemo(() => {
    const filePath = diffFilePath(diffContent);
    return filePath ? languageFromFileName(filePath) : undefined;
  }, [diffContent]);

  if (parsedLines.length === 0) {
    return <Text color={activeTheme.text.secondary}>No changes detected.</Text>;
  }

  const displayableLines = parsedLines.filter(
    (l) => l.type !== "hunk" && l.type !== "other",
  );

  const windowStart = Math.min(
    Math.max(0, offset),
    Math.max(0, displayableLines.length - 1),
  );
  const truncatedLines = displayableLines.slice(
    windowStart,
    windowStart + Math.max(1, maxLines),
  );
  const hiddenAbove = windowStart;
  const hiddenBelow = Math.max(
    0,
    displayableLines.length - (windowStart + truncatedLines.length),
  );

  // Group consecutive add/delete lines for word-level diffing
  const groupedLines: Array<{ type: "group" | "single"; lines: DiffLine[] }> =
    [];
  let currentGroup: DiffLine[] = [];

  for (let i = 0; i < truncatedLines.length; i++) {
    const line = truncatedLines[i];
    const nextLine = truncatedLines[i + 1];

    if (line.type === "add" || line.type === "del") {
      currentGroup.push(line);

      // If next line is different type or end of array, finalize the group
      if (!nextLine || (nextLine.type !== "add" && nextLine.type !== "del")) {
        groupedLines.push(...processGroup(currentGroup));
        currentGroup = [];
      }
    } else {
      groupedLines.push({ type: "single", lines: [line] });
    }
  }

  return (
    <Box flexDirection="column">
      {groupedLines.map((group, groupIndex) => {
        if (group.type === "single") {
          const line = group.lines[0];
          const lineKey = `diff-line-${groupIndex}`;
          let gutterNumStr = "";
          let prefixSymbol = " ";
          let dim = false;
          let backgroundColor: string | undefined = undefined;
          let textColor = activeTheme.diff.contextText;

          switch (line.type) {
            case "add":
              gutterNumStr = (line.newLine ?? "").toString();
              backgroundColor = activeTheme.diff.addBackground;
              textColor = activeTheme.diff.addText;
              prefixSymbol = "+";
              break;
            case "del":
              gutterNumStr = (line.oldLine ?? "").toString();
              backgroundColor = activeTheme.diff.delBackground;
              textColor = activeTheme.diff.delText;
              prefixSymbol = "-";
              break;
            case "context":
              gutterNumStr = (line.newLine ?? "").toString();
              dim = true;
              prefixSymbol = " ";
              textColor = activeTheme.diff.contextText;
              break;
            default:
              return null;
          }

          return (
            <Box key={lineKey} flexDirection="row">
              <Text color={activeTheme.diff.gutterText}>
                {gutterNumStr.padEnd(4)}{" "}
              </Text>
              <Text
                backgroundColor={backgroundColor}
                color={textColor}
                dimColor={dim}
              >
                {prefixSymbol}{" "}
              </Text>
              <Text
                backgroundColor={backgroundColor}
                color={textColor}
                dimColor={dim}
              >
                {language && line.type === "context"
                  ? highlightCode(line.content, language, activeTheme.syntax, {
                      dimColor: true,
                    })
                  : line.content}
              </Text>
            </Box>
          );
        } else {
          // Word-level diff group
          const delLines = group.lines.filter((l) => l.type === "del");
          const addLines = group.lines.filter((l) => l.type === "add");

          return (
            <WordLevelDiffGroup
              key={`group-${groupIndex}`}
              groupIndex={groupIndex}
              delLines={delLines}
              addLines={addLines}
              activeTheme={activeTheme}
            />
          );
        }
      })}
      {showFooter && (hiddenAbove > 0 || hiddenBelow > 0) && (
        <Text color={activeTheme.text.secondary} dimColor>
          {hiddenAbove > 0 ? `... (${hiddenAbove} earlier lines)` : ""}
          {hiddenAbove > 0 && hiddenBelow > 0 ? " " : ""}
          {hiddenBelow > 0 ? `... (${hiddenBelow} more lines)` : ""}
        </Text>
      )}
    </Box>
  );
};
