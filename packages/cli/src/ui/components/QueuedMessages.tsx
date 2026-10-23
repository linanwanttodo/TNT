import { Box, Text } from "ink";
import React from "react";

import type { QueuedMessage } from "../../stream/messageQueue.js";
import { theme } from "../theme/tokens.js";

const MAX_PREVIEW = 80;

/** One line, so a pasted multi-line message cannot push the dock off screen. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PREVIEW ? `${flat.slice(0, MAX_PREVIEW)}...` : flat;
}

export interface QueuedMessagesProps {
  messages: readonly QueuedMessage[];
}

/**
 * The messages waiting for the current turn to finish. The rows are read-only;
 * actions apply to the newest entry from the composer's key handler, where
 * Ctrl+X and Ctrl+R are already outside the text buffer's key set.
 */
export const QueuedMessages: React.FC<QueuedMessagesProps> = ({ messages }) => {
  if (messages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingBottom={1}>
      {messages.map((message, index) => (
        <Box key={message.id}>
          <Text color={theme.text.secondary} dimColor>
            {"[queued] "}
          </Text>
          <Text color={theme.text.primary}>{preview(message.message)}</Text>
          {index === messages.length - 1 && (
            <Text color={theme.text.subtle} dimColor>
              {"  ctrl+x remove  ctrl+r edit"}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
