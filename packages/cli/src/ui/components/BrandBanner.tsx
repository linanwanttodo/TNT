import { Box, Text } from "ink";
import React from "react";

import type { ModelServiceState } from "../../services/types.js";
import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useServices } from "../hooks/useService.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

/**
 * The intro banner: a small bordered info panel in the top-left corner with a
 * solid light-blue wordmark, the version and the selected model. Static on
 * purpose - the banner must vanish into the transcript, not hold attention.
 */
const GIANT_T_ROWS = [
  "██████",
  "██████",
  "██████",
  "  ██  ",
  "  ██  ",
  "  ██  ",
  "  ██  ",
  "  ██  ",
  "  ██  ",
  "  ██  ",
];

const PIXEL_N = ["█   █", "██  █", "█ █ █", "█  ██", "█   █"];

const PIXEL_T = ["█████", "  █  ", "  █  ", "  █  ", "  █  "];

const WORD_ROWS = PIXEL_N.map((row, index) => `${row}  ${PIXEL_T[index]}`);

const BRAND_BLUE = "#7dd3fc";

interface BrandBannerProps {
  version: string;
}

export const BrandBanner: React.FC<BrandBannerProps> = ({ version }) => {
  const { columns } = useTerminalSize();
  const { services } = useServices<{ model: ModelServiceState }>(["model"]);
  const modelName = services.model?.model?.name;

  const needed = 6 + 2 + 5 + 2 + 5 + 4;

  if (columns < needed || process.env.NO_COLOR) {
    return <Text>{getDisplayableAsciiArt()}</Text>;
  }

  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexDirection="column"
      alignSelf="flex-start"
      marginLeft={1}
    >
      <Box flexDirection="row">
        <Box flexDirection="column">
          {GIANT_T_ROWS.map((row, index) => (
            <Text key={index} color={BRAND_BLUE}>
              {row}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {WORD_ROWS.map((row, index) => (
            <Text key={index} color={BRAND_BLUE} bold>
              {row}
            </Text>
          ))}
          <Text color="gray" dimColor>
            {`v${version}`}
          </Text>
          {modelName && (
            <Text color="gray" dimColor>
              {modelName}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};
