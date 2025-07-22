import { Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";

interface ContextPercentageDisplayProps {
  percentage: number;
}

/**
 * Component to display the current context usage percentage
 * Shows the non-zero percentage in gray color for consistency with other status indicators
 */
export const ContextPercentageDisplay: React.FC<
  ContextPercentageDisplayProps
> = ({ percentage }) => {
  return (
    <Text color="dim">
      {t("status.context")}: {percentage}%
    </Text>
  );
};
