import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { getToolDisplayName } from "../../tools/index.js";
import { ToolCallPreview } from "../../tools/types.js";
import { ColoredDiff } from "../ColoredDiff.js";
import { theme } from "../theme/tokens.js";

import { ChecklistDisplay } from "./ChecklistDisplay.js";

interface ToolPreviewProps {
  toolCallPreview?: ToolCallPreview[];
  toolName: string;
  toolArgs: any;
}

/**
 * Generates a preview of what a tool will do based on its arguments.
 *
 * The preview is drawn inside the caller's left guide, so it carries no marker
 * of its own and no leading blank row.
 */
export const ToolPreview: React.FC<ToolPreviewProps> = ({
  toolCallPreview,
  toolName,
  toolArgs,
}) => {
  if (toolCallPreview) {
    return (
      <Box display={"flex"} flexDirection="column">
        {toolCallPreview.map((preview, index) => {
          if (preview.type === "text") {
            return (
              <Box key={index} paddingLeft={preview.paddingLeft ?? 0}>
                <Text color={preview.color ?? theme.text.secondary}>
                  {preview.content}
                </Text>
              </Box>
            );
          } else if (preview.type === "checklist") {
            return (
              <Box key={index}>
                <ChecklistDisplay
                  content={t("tool.taskListStatus", {
                    content: preview.content,
                  })}
                />
              </Box>
            );
          } else {
            return <ColoredDiff key={index} diffContent={preview.content} />;
          }
        })}
      </Box>
    );
  }

  let message = t("tool.willCall", { name: getToolDisplayName(toolName) });
  const argCount = Object.keys(toolArgs || {}).length;
  if (argCount > 0) {
    message += ` with ${argCount} argument${argCount === 1 ? "" : "s"}`;
  }

  return (
    <Box>
      <Text color={theme.text.secondary}>{message}</Text>
    </Box>
  );
};
