import { Box, Text } from "ink";
import React from "react";

import { FireLogo } from "./components/FireLogo.js";

const IntroMessage: React.FC = () => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* The model and workspace are already in the status bar. */}
      <FireLogo />
      <Text> </Text>
    </Box>
  );
};

export { IntroMessage };
