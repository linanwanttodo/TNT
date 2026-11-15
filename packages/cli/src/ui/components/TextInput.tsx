/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Render-only port of gemini-cli's TextInput: draws the buffer's visual
 * viewport and places the terminal cursor on the caret cell through the
 * forked ink's terminalCursor props, which is what keeps IME pre-edit visible
 * in JetBrains terminals. Key dispatch lives in UserInput.
 */

import chalk from "chalk";
import { Text, Box, type DOMElement } from "ink";
import React, { useRef } from "react";

import { useClickRegion } from "../hooks/useClickRegion.js";
import { theme } from "../theme/tokens.js";
import { cpSlice, cpIndexToOffset } from "../utils/textUtils.js";

import type { TextBuffer } from "./text-buffer.js";

export interface TextInputProps {
  buffer: TextBuffer;
  placeholder?: string;
  focus?: boolean;
}

export function TextInput({
  buffer,
  placeholder = "",
  focus = true,
}: TextInputProps): React.JSX.Element {
  const { text, visualCursor, viewportVisualLines, visualScrollRow } = buffer;
  const [cursorVisualRowAbsolute, cursorVisualColAbsolute] = visualCursor;

  // Clicking inside the box moves the caret to the clicked cell, exactly like
  // editing in a text area; the buffer converts the visual cell back to its
  // logical position, wide characters included.
  const containerRef = useRef<DOMElement>(null);
  useClickRegion(containerRef, (relativeX: number, relativeY: number) => {
    if (focus) {
      buffer.moveToVisualPosition(visualScrollRow + relativeY, relativeX);
    }
  });

  const showPlaceholder = text.length === 0 && placeholder;

  if (showPlaceholder) {
    return (
      <Box ref={containerRef}>
        {focus ? (
          <Text terminalCursorFocus={focus} terminalCursorPosition={0}>
            {chalk.inverse(" ")}
            <Text color={theme.text.secondary}>{` ${placeholder}`}</Text>
          </Text>
        ) : (
          <Text color={theme.text.secondary}>{placeholder}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box ref={containerRef} flexDirection="column">
      {viewportVisualLines.map((lineText, idx) => {
        const currentVisualRow = visualScrollRow + idx;
        const isCursorLine =
          focus && currentVisualRow === cursorVisualRowAbsolute;

        const lineDisplay = isCursorLine
          ? cpSlice(lineText, 0, cursorVisualColAbsolute) +
            chalk.inverse(
              cpSlice(
                lineText,
                cursorVisualColAbsolute,
                cursorVisualColAbsolute + 1,
              ) || " ",
            ) +
            cpSlice(lineText, cursorVisualColAbsolute + 1)
          : lineText;

        return (
          <Box key={idx} height={1}>
            <Text
              terminalCursorFocus={isCursorLine}
              terminalCursorPosition={cpIndexToOffset(
                lineText,
                cursorVisualColAbsolute,
              )}
            >
              {lineDisplay}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
