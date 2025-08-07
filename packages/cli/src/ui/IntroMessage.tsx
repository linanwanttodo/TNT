import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React from "react";

import { getDisplayableAsciiArt } from "../startup/asciiArt.js";
import { t } from "../i18n/index.js";

interface IntroMessageProps {
  config?: AssistantUnrolled;
  model?: ModelConfig;
  organizationName?: string;
}

const IntroMessage: React.FC<IntroMessageProps> = ({
  config,
  model,
  organizationName,
}) => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* ASCII Art */}
      <Text>{getDisplayableAsciiArt()}</Text>
      <Text> </Text>

      {/* Organization name */}
      {organizationName && (
        <Text color="blue">
          <Text bold>{t("intro.org")}:</Text>{" "}
          <Text color="white">{organizationName}</Text>
        </Text>
      )}

      {/* Agent name */}
      {config && (
        <Text color="blue">
          <Text bold>{t("intro.config")}:</Text>{" "}
          <Text color="white">{config.name}</Text>
        </Text>
      )}

      {/* Model */}
      {model ? (
        <Text color="blue">
          <Text bold>{t("intro.model")}:</Text>{" "}
          <Text color="white">{model.name.split("/").pop()}</Text>
        </Text>
      ) : (
        <Text color="blue">
          <Text bold>{t("intro.model")}:</Text>{" "}
          <Text color="dim">{t("intro.loading")}</Text>
        </Text>
      )}

      <Text> </Text>
    </Box>
  );
};

export { IntroMessage };
