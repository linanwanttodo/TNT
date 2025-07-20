import { Box, Text } from "ink";
import React from "react";

import { t } from "../i18n/index.js";

interface ModelCapabilityWarningProps {
  modelName: string;
}

const ModelCapabilityWarning: React.FC<ModelCapabilityWarningProps> = ({
  modelName,
}) => {
  return (
    <Box flexDirection="column" paddingX={0}>
      <Box flexDirection="row" alignItems="center">
        <Text bold color="white">
          {t("model.warningTitle")}
        </Text>
      </Box>
      <Text color="gray">
        {t("model.notRecommended", { model: modelName })}
      </Text>
    </Box>
  );
};

export { ModelCapabilityWarning };
