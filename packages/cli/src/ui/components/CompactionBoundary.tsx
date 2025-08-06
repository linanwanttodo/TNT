import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { MarkdownRenderer } from "../MarkdownRenderer.js";

interface CompactionBoundaryProps {
  /** Summary that replaced the compacted turns. */
  summary: string;
}

/**
 * Marks where older turns were replaced by a summary.
 *
 * The reference implementations treat compaction as a first-class transcript
 * event rather than a silent rewrite, so the boundary stays visible and the
 * summary is rendered inline instead of being folded into a collapsed card.
 */
const CompactionBoundary: React.FC<CompactionBoundaryProps> = ({ summary }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray" dimColor>
          {"── "}
        </Text>
        <Text color="yellow">{t("compaction.boundary")}</Text>
        <Text color="gray" dimColor>
          {" ──"}
        </Text>
      </Box>
      <MarkdownRenderer content={summary} />
    </Box>
  );
};

export { CompactionBoundary };
