import { Box, Text } from "ink";
import React from "react";

import { getVersion } from "../startup/version.js";

import { BrandBanner } from "./components/BrandBanner.js";

const IntroMessage: React.FC = () => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* The model and workspace are already in the status bar. */}
      <BrandBanner version={getVersion()} />
      <Text> </Text>
    </Box>
  );
};

export { IntroMessage };
