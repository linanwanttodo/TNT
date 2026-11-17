import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { useTheme } from "../theme/tokens.js";

/**
 * Marks where older turns were replaced by a summary.
 *
 * The summary itself is model context - every surface keeps it out of the
 * transcript. The reference clients draw the same one-line rule, and printing
 * the brief into the conversation is what made a compaction look like the
 * assistant had suddenly answered with a handoff document.
 */
const CompactionBoundary: React.FC = () => {
  const theme = useTheme();

  return (
    <Box marginBottom={1}>
      <Text color="gray" dimColor>
        {"── "}
      </Text>
      <Text color={theme.text.subtle} dimColor>
        {t("compaction.boundary")}
      </Text>
      <Text color="gray" dimColor>
        {" ──"}
      </Text>
    </Box>
  );
};

export { CompactionBoundary };
