import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useTheme } from "../theme/tokens.js";

/** Below this width only the essential state fits; the hint row stays blank. */
export const HELP_HINT_MIN_COLUMNS = 80;

export type ComposerHint =
  | { kind: "interrupted" }
  | { kind: "queued"; count: number }
  | { kind: "working" }
  | { kind: "help" };

/**
 * One transient hint at a time. The interrupted banner, the interrupt key and
 * the queue controls used to be drawn in three places at once, so a reader had
 * to search the screen for the one that applied. The newest state wins: an
 * interruption replaces the queue hint, a queued message replaces the running
 * hint, and the help hint is only the idle fallback. The idle hint names the
 * command that prints the key bindings: the shortcut list is a command, not a
 * key the reader has to guess.
 */
export function selectComposerHint(input: {
  wasInterrupted: boolean;
  queuedCount: number;
  working: boolean;
  columns: number;
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
  if (input.columns >= HELP_HINT_MIN_COLUMNS) {
    return { kind: "help" };
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
    case "help":
      return t("composer.helpHint");
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
  const { columns } = useTerminalSize();
  const theme = useTheme();
  const hint = selectComposerHint({
    wasInterrupted,
    queuedCount,
    working,
    columns,
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
