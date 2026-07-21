import { Box, Text } from "ink";
import React from "react";

import { SERVICE_NAMES } from "../../services/types.js";
import type { ModelServiceState } from "../../services/types.js";
import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useServices } from "../hooks/useService.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

import { getThinkingDepth } from "./BottomStatusBar.js";

/**
 * The intro header: a compact four-row wordmark with just the facts the
 * reader needs on entry - version, model and where to find help. No frame,
 * no fields, no hint pane.
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
  const model = useServices<{ model: ModelServiceState }>([SERVICE_NAMES.MODEL])
    .services.model?.model;

  const modelName = model?.name || model?.model || "—";
  const thinking = getThinkingDepth(model);

  if (columns < 44 || process.env.NO_COLOR) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={1}
        marginTop={1}
        marginBottom={1}
      >
        <Text>{getDisplayableAsciiArt()}</Text>
        <Text>{`TNT CLI v${version} · ${modelName}`}</Text>
        <Text color="gray">Send /help for help information.</Text>
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
        <Text bold>TNT CLI v{version}</Text>
        <Text color="gray">
          {modelName}
          {thinking ? ` · ${thinking}` : ""}
        </Text>
        <Text color="gray">Send /help for help information.</Text>
      </Box>
    </Box>
  );
};
