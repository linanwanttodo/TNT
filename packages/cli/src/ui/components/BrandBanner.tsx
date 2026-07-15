import { Box, Text } from "ink";
import React from "react";

import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

/**
 * The intro header, laid out like the reference CLI's: a compact four-row
 * wordmark on the left with the name and version to its right, top-aligned, in
 * the terminal's top-left corner. The model lives in the status row instead.
 * Static on purpose.
 */
const LOGO_ROWS = [
  "███████  ██   ██  ███████",
  " █████   ███  ██   █████ ",
  "  ███    ██ █ ██    ███  ",
  "  ███    ██  ███    ███  ",
];

const BRAND_BLUE = "#7dd3fc";

interface BrandBannerProps {
  version: string;
}

export const BrandBanner: React.FC<BrandBannerProps> = ({ version }) => {
  const { columns } = useTerminalSize();

  if (columns < 44 || process.env.NO_COLOR) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={1}
        marginTop={1}
        marginBottom={1}
      >
        <Text>{getDisplayableAsciiArt()}</Text>
        <Text>TNT CLI v{version}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" paddingLeft={1} marginTop={1} marginBottom={1}>
      <Box flexShrink={0} flexDirection="column">
        {LOGO_ROWS.map((row, index) => (
          <Text key={index} color={BRAND_BLUE}>
            {row}
          </Text>
        ))}
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Box>
          <Text bold>TNT CLI</Text>
          <Text color="gray"> v{version}</Text>
        </Box>
      </Box>
    </Box>
  );
};
