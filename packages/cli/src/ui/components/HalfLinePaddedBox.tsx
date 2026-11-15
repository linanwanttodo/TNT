import chalk from "chalk";
import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { useTerminalSize } from "../hooks/useTerminalSize.js";

export interface HalfLinePaddedBoxProps {
  /** The solid surface colour drawn behind the composer. */
  backgroundBaseColor: string;
  children: React.ReactNode;
}

function safeRepeat(text: string, width: number): string {
  return width > 0 ? text.repeat(width) : "";
}

/**
 * Ported from gemini-cli: a container that renders a solid background band
 * with half-line padding above and below the content, drawn with block
 * characters. Terminals without true colour fall back to ink's backgroundColor
 * with whole-line padding.
 */
export const HalfLinePaddedBox: React.FC<HalfLinePaddedBoxProps> = ({
  backgroundBaseColor,
  children,
}) => {
  const { columns: terminalWidth } = useTerminalSize();
  const safeWidth = Math.max(0, Math.floor(terminalWidth || 0));

  const colorize = useMemo(() => {
    if (!backgroundBaseColor) return null;
    return chalk.level >= 2 ? chalk.hex(backgroundBaseColor) : null;
  }, [backgroundBaseColor]);

  if (!colorize) {
    return (
      <Box
        width={safeWidth}
        backgroundColor={backgroundBaseColor || undefined}
        paddingX={0}
        paddingY={0}
      >
        {children}
      </Box>
    );
  }

  return (
    <Box width={safeWidth} flexDirection="column" flexShrink={0}>
      <Box width={safeWidth} flexDirection="row">
        <Text>{colorize(safeRepeat("▄", safeWidth))}</Text>
      </Box>
      <Box
        width={safeWidth}
        flexDirection="column"
        flexShrink={0}
        backgroundColor={backgroundBaseColor}
      >
        {children}
      </Box>
      <Box width={safeWidth} flexDirection="row">
        <Text>{colorize(safeRepeat("▀", safeWidth))}</Text>
      </Box>
    </Box>
  );
};
