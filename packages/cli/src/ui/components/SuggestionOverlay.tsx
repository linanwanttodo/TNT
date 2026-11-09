import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  MAX_VISIBLE_SUGGESTIONS,
  suggestionDisplay,
  type SuggestionItem,
  visibleSuggestionWindow,
  windowStart,
} from "../suggestionSources.js";
import { useTheme } from "../theme/tokens.js";

const MAX_DESCRIPTION_LENGTH = 80;

const truncateDescription = (description: string): string => {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  return (
    Array.from(description).slice(0, MAX_DESCRIPTION_LENGTH).join("").trim() +
    "…"
  );
};

export interface SuggestionOverlayProps {
  /** False keeps the component out of the layout entirely. */
  show: boolean;
  items: readonly SuggestionItem[];
  selectedIndex: number;
  /** Shown when nothing matches. */
  emptyText: string;
  /** Set when a parent command's children are shown, e.g. `/language`. */
  levelLabel?: string | null;
  /** Overrides the navigation hint. */
  hint?: string;
  size?: number;
}

/**
 * The one suggestion list above the composer. It draws the current token's
 * rows - `/` commands, or `@` files, agents and MCP resources - with Claude
 * Code's type marks, five visible rows and a window that slides with the
 * selection. Keys live in `UserInput`; this component only draws.
 */
const SuggestionOverlay: React.FC<SuggestionOverlayProps> = ({
  show,
  items,
  selectedIndex,
  emptyText,
  levelLabel,
  hint,
  size = MAX_VISIBLE_SUGGESTIONS,
}) => {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  if (!show) {
    return null;
  }

  const visibleItems = visibleSuggestionWindow(items, selectedIndex, size);
  const start = windowStart(items.length, selectedIndex, size);
  const labels = visibleItems.map(suggestionDisplay);
  const nameWidth = Math.min(
    Math.max(...labels.map((label) => label.length), 0) + 6,
    Math.floor(columns * 0.45),
  );
  const hintText = hint ?? t("commands.navigation");

  return (
    <Box
      paddingX={1}
      marginX={1}
      marginBottom={1}
      flexDirection="column"
      width={columns}
    >
      {levelLabel && (
        <Text color="gray" dimColor>
          {`-- ${levelLabel} --`}
        </Text>
      )}

      {visibleItems.length === 0 ? (
        <Text color="gray">{emptyText}</Text>
      ) : (
        visibleItems.map((item, index) => {
          const isSelected = start + index === selectedIndex;

          return (
            <Box key={item.key} width={columns} flexWrap="nowrap">
              <Box width={nameWidth} flexShrink={0}>
                <Text
                  color={isSelected ? theme.accent : "white"}
                  bold={isSelected}
                  wrap="truncate"
                >
                  {"  " + suggestionDisplay(item)}
                </Text>
              </Box>
              <Box flexGrow={1} paddingLeft={2}>
                <Text
                  color={isSelected ? theme.accent : "gray"}
                  wrap="truncate"
                >
                  {truncateDescription(item.description)}
                </Text>
              </Box>
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {items.length > size
            ? `${hintText} (${start + visibleItems.length}/${items.length})`
            : hintText}
        </Text>
      </Box>
    </Box>
  );
};

export { SuggestionOverlay };
