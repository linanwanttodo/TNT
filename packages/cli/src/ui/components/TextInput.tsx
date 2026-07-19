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
import { Text, Box } from "ink";
import React from "react";

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

  const showPlaceholder = text.length === 0 && placeholder;

  if (showPlaceholder) {
    return (
      <Box>
        {focus ? (
          <Text terminalCursorFocus={focus} terminalCursorPosition={0}>
            {chalk.inverse(cpSlice(placeholder, 0, 1) || " ")}
            <Text color={theme.text.secondary}>{cpSlice(placeholder, 1)}</Text>
          </Text>
        ) : (
          <Text color={theme.text.secondary}>{placeholder}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
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
