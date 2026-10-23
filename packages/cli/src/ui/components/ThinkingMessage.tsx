import { Box, Text, type DOMElement } from "ink";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

import { t } from "../../i18n/index.js";
import { markLayoutDirty } from "../hooks/layoutDirty.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { useReasoningExpanded } from "../reasoningFold.js";
import { useTheme } from "../theme/tokens.js";

export interface ThinkingMessageProps {
  thought: string;
  isStreaming?: boolean;
}

/**
 * Normalizes thought text for display: trims trailing space, keeps paragraph
 * breaks, and collapses runs of blank lines so a provider that emits many of
 * them does not turn the thought into a column of gaps.
 */
function normalizeThoughtLines(raw: string): string[] {
  if (!raw) return [];

  const lines: string[] = [];
  let previousBlank = false;

  for (const source of raw.replace(/\r/g, "").split("\n")) {
    const line = source.replace(/\s+$/, "");

    if (line.trim() === "") {
      if (lines.length > 0 && !previousBlank) {
        lines.push("");
      }
      previousBlank = true;
      continue;
    }

    lines.push(line);
    previousBlank = false;
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Thinking/reasoning text emitted by thinking models. Rendered as a separate
 * italic block above the assistant answer, with paragraphs preserved.
 *
 * A block streams open, then folds when the round ends; clicking one block
 * toggles just that block. Ctrl+O sets the default for every finished block.
 */
export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({
  thought,
  isStreaming = false,
}) => {
  const activeTheme = useTheme();
  const globalExpanded = useReasoningExpanded();
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? (isStreaming || globalExpanded);
  const blockRef = useRef<DOMElement>(null);
  const lines = useMemo(() => normalizeThoughtLines(thought), [thought]);

  useClickRegion(blockRef, () => {
    setOverride(!expanded);
  });

  useLayoutEffect(() => {
    markLayoutDirty();
  }, [expanded]);

  if (lines.length === 0) {
    return null;
  }

  if (!expanded) {
    return (
      <Box ref={blockRef}>
        <Text color={activeTheme.text.secondary} italic>
          {t("ui.reasoningFolded")}
          {isStreaming ? " " : ""}
        </Text>
      </Box>
    );
  }

  return (
    <Box ref={blockRef} flexDirection="column">
      {lines.map((line, index) => (
        <Text
          key={`thought-line-${index}`}
          color={activeTheme.text.secondary}
          italic
        >
          {line === "" ? " " : line}
        </Text>
      ))}
    </Box>
  );
};
