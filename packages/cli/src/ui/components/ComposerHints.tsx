import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { useTheme } from "../theme/tokens.js";

export type ComposerHint =
  | { kind: "interrupted" }
  | { kind: "queued"; count: number }
  | { kind: "working" };

/**
 * One transient hint at a time. The interrupted banner, the interrupt key and
 * the queue controls used to be drawn in three places at once, so a reader had
 * to search the screen for the one that applied. The newest state wins: an
 * interruption replaces the queue hint, a queued message replaces the running
 * hint. Idle renders nothing - the composer's hints row stays allocated so a
 * transient hint cannot move the input by a row, but it carries no occupancy
 * filler: command discovery lives in the "/" slash menu.
 */
export function selectComposerHint(input: {
  wasInterrupted: boolean;
  queuedCount: number;
  working: boolean;
}): ComposerHint | null {
  if (input.wasInterrupted) {
    return { kind: "interrupted" };
  }
  if (input.queuedCount > 0) {
    return { kind: "queued", count: input.queuedCount };
  }
  if (input.working) {
    return { kind: "working" };
  }
  return null;
}

export function composerHintText(hint: ComposerHint | null): string | null {
  switch (hint?.kind) {
    case "interrupted":
      return t("interrupted.message");
    case "queued":
      return t("composer.queuedHint", { count: hint.count });
    case "working":
      return t("composer.interruptHint");
    default:
      return null;
  }
}

export interface ComposerHintsProps {
  wasInterrupted: boolean;
  queuedCount?: number;
  working: boolean;
}

/**
 * The single hint row under the composer. The row is always allocated so a
 * transient hint cannot move the input by a row and restart the layout.
 */
export const ComposerHints: React.FC<ComposerHintsProps> = ({
  wasInterrupted,
  queuedCount = 0,
  working,
}) => {
  const theme = useTheme();
  const hint = selectComposerHint({
    wasInterrupted,
    queuedCount,
    working,
  });
  const text = composerHintText(hint);

  return (
    <Box height={1} paddingX={2} flexShrink={0} overflow="hidden">
      {text && (
        <Text
          color={
            hint?.kind === "interrupted"
              ? theme.status.warning
              : theme.text.subtle
          }
          dimColor={hint?.kind !== "interrupted"}
          wrap="truncate-end"
        >
          {text}
        </Text>
      )}
    </Box>
  );
};
