import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

import { t } from "../i18n/index.js";

import { ColoredDiff, parseDiffWithLineNumbers } from "./ColoredDiff.js";
import { diffWindow, hunkDisplayRows, nextHunk } from "./diffViewport.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { diffFilePath } from "./SyntaxHighlighter.js";
import { useTheme } from "./theme/tokens.js";

interface DiffViewerProps {
  diffContent: string;
  onClose: () => void;
}

/**
 * The whole change, scrollable, with the file it belongs to and the hunk the
 * reader is in.
 *
 * The transcript's card and the approval card both fold a diff to a few rows on
 * purpose; this screen is the answer to "show me the rest". It therefore renders
 * a window the terminal can hold and moves that window - one row with the arrows,
 * a page with PageUp/PageDown, a hunk with `n`/`p` - instead of handing the
 * renderer every line and letting the terminal clip it.
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffContent,
  onClose,
}) => {
  const theme = useTheme();
  const { rows } = useTerminalSize();
  const [offset, setOffset] = useState(0);

  const lines = useMemo(
    () => parseDiffWithLineNumbers(diffContent),
    [diffContent],
  );
  const displayable = useMemo(
    () => lines.filter((line) => line.type !== "hunk" && line.type !== "other"),
    [lines],
  );
  const hunks = useMemo(() => hunkDisplayRows(lines), [lines]);
  // Header, status line, borders and padding are not rows of the change.
  const height = Math.max(4, rows - 7);
  const view = diffWindow(displayable.length, offset, height);
  const currentHunk = hunks.filter((row) => row <= view.offset).length;
  const file = diffFilePath(diffContent);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setOffset(Math.max(0, view.offset - 1));
      return;
    }
    if (key.downArrow) {
      setOffset(view.offset + 1);
      return;
    }
    if (key.pageUp) {
      setOffset(Math.max(0, view.offset - height));
      return;
    }
    if (key.pageDown) {
      setOffset(view.offset + height);
      return;
    }
    if (input === "n" || input === "p") {
      const target = nextHunk(hunks, view.offset, input === "n" ? 1 : -1);
      if (target !== undefined) {
        setOffset(Math.max(0, target));
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      height="100%"
      borderStyle="single"
      borderColor={theme.border.focus}
      padding={1}
    >
      <Box marginBottom={1} justifyContent="space-between">
        <Text color={theme.accent} bold>
          {t("diff.title", {
            file: file ?? t("diff.unknownFile"),
            added: lines.filter((line) => line.type === "add").length,
            removed: lines.filter((line) => line.type === "del").length,
          })}
        </Text>
        {hunks.length > 0 && (
          <Text color={theme.text.secondary} dimColor>
            {t("diff.hunk", { current: currentHunk, total: hunks.length })}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {diffContent.trim() ? (
          <ColoredDiff
            diffContent={diffContent}
            maxLines={height}
            offset={view.offset}
            showFooter={false}
          />
        ) : (
          <Text color={theme.text.secondary} italic>
            {t("diff.empty")}
          </Text>
        )}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.text.secondary} dimColor>
          {t("diff.position", {
            start: view.offset + 1,
            end: view.end,
            total: displayable.length,
          })}
        </Text>
        <Text color={theme.text.secondary} dimColor>
          {t("diff.hint")}
        </Text>
      </Box>
    </Box>
  );
};
