import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React from "react";

import { getDisplayableAsciiArt } from "../startup/asciiArt.js";

interface IntroMessageProps {
  config?: AssistantUnrolled;
  model?: ModelConfig;
  organizationName?: string;
}

const IntroMessage: React.FC<IntroMessageProps> = () => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* The model and workspace are already in the status bar. */}
      <Text>{getDisplayableAsciiArt()}</Text>
      <Text> </Text>
    </Box>
  );
};

export { IntroMessage };
