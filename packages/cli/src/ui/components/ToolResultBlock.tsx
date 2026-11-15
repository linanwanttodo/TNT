import { Box, Text } from "ink";
import React, { createContext, useContext, type ReactNode } from "react";

import { claudeGlyphs } from "../symbols.js";
import { useTheme } from "../theme/tokens.js";

const RESULT_GUTTER = `  ${claudeGlyphs().resultGutter} `;

/**
 * A result is drawn once behind the gutter. A result rendered inside another
 * one is already in the outer result column, so it must not print a second
 * gutter of its own.
 */
const NestedResult = createContext(false);

export interface ToolResultBlockProps {
  children: ReactNode;
}

export function ToolResultBlock({ children }: ToolResultBlockProps) {
  const activeTheme = useTheme();
  const nested = useContext(NestedResult);

  if (nested) {
    return <>{children}</>;
  }

  return (
    <NestedResult.Provider value={true}>
      <Box flexDirection="row" width="100%">
        <Box flexShrink={0}>
          <Text color={activeTheme.text.subtle}>{RESULT_GUTTER}</Text>
        </Box>
        <Box flexDirection="column" flexShrink={1} flexGrow={1} minWidth={0}>
          {children}
        </Box>
      </Box>
    </NestedResult.Provider>
  );
}
