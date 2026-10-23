import { Box, Text } from "ink";
import React from "react";

import type { ModelServiceState } from "../../services/types.js";
import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useServices } from "../hooks/useService.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

/**
 * The intro header, laid out like the reference CLI's: a compact four-row
 * wordmark on the left with the name, version and selected model to its
 * right, top-aligned, in the terminal's top-left corner. Static on purpose.
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
  const { services } = useServices<{ model: ModelServiceState }>(["model"]);
  const modelName = services.model?.model?.name;

  if (columns < 44 || process.env.NO_COLOR) {
    return <Text>{getDisplayableAsciiArt()}</Text>;
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
        <Box height={1} />
        {modelName && <Text color="gray">{modelName}</Text>}
      </Box>
    </Box>
  );
};
