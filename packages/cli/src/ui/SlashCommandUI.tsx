import { type AssistantConfig } from "@tnt/sdk";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../i18n/index.js";

import { getAllSlashCommands, type SlashCommand } from "./commands/index.js";
import { useLocale } from "./hooks/useLocale.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useTheme } from "./theme/tokens.js";

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

interface SlashCommandUIProps {
  assistant?: AssistantConfig;
  /** The already-loaded command list; omitted, the component loads its own. */
  commands?: SlashCommand[];
  /** Set when a parent command's children are shown, e.g. `/language`. */
  levelLabel?: string | null;
  filter: string;
  selectedIndex: number;
}

/** How many commands show at once in the palette window. */
const MAX_VISIBLE_COMMANDS = 5;

const SlashCommandUI: React.FC<SlashCommandUIProps> = ({
  assistant,
  commands,
  levelLabel,
  filter,
  selectedIndex,
}) => {
  const locale = useLocale();
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const [selfLoaded, setSelfLoaded] = useState<SlashCommand[]>(
    // Fallback - basic commands without assistant
    [
      { name: "help", description: t("cmd.help"), category: "system" },
      {
        name: "clear",
        description: t("cmd.clear"),
        category: "system",
      },
      { name: "exit", description: t("cmd.exit"), category: "system" },
    ],
  );

  useEffect(() => {
    if (commands) return;

    let stale = false;

    const loadCommands = async () => {
      if (assistant) {
        const loaded = await getAllSlashCommands(assistant);
        if (!stale) {
          setSelfLoaded(loaded);
        }
      }
    };

    void loadCommands();

    return () => {
      stale = true;
    };
  }, [commands, assistant?.prompts, assistant?.rules, locale]);

  const allCommands = commands ?? selfLoaded;

  // Filter commands based on the current filter
  const filteredCommands = allCommands
    .filter((cmd) => cmd.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(filter.toLowerCase());
      const bStartsWith = b.name.toLowerCase().startsWith(filter.toLowerCase());

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      return a.name.localeCompare(b.name);
    });

  if (filteredCommands.length === 0) {
    return (
      <Box paddingX={1} marginX={1} marginBottom={1}>
        <Text color="gray">{t("commands.noMatches")}</Text>
      </Box>
    );
  }

  // A sliding window keeps the selected command visible while the rest of the
  // list stays out of the layout.
  const windowStart = Math.max(
    0,
    Math.min(
      selectedIndex - (MAX_VISIBLE_COMMANDS - 1),
      filteredCommands.length - MAX_VISIBLE_COMMANDS,
    ),
  );
  const visibleCommands = filteredCommands.slice(
    windowStart,
    windowStart + MAX_VISIBLE_COMMANDS,
  );

  const nameWidth = Math.min(
    Math.max(...visibleCommands.map((cmd) => cmd.name.length)) + 6,
    Math.floor(columns * 0.45),
  );

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
      {windowStart > 0 && <Text color="gray">▲</Text>}

      {visibleCommands.map((command, index) => {
        const isSelected = windowStart + index === selectedIndex;
        const label = `/${command.name}`;
        const description = truncateDescription(command.description);

        return (
          <Box key={command.name} width={columns} flexWrap="nowrap">
            <Box width={nameWidth} flexShrink={0}>
              <Text
                color={isSelected ? theme.accent : "white"}
                bold={isSelected}
                wrap="truncate"
              >
                {"  " + label}
              </Text>
            </Box>
            <Box flexGrow={1} paddingLeft={2}>
              <Text color={isSelected ? theme.accent : "gray"} wrap="truncate">
                {description}
              </Text>
            </Box>
          </Box>
        );
      })}

      {windowStart + visibleCommands.length < filteredCommands.length && (
        <Text color="gray">▼</Text>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {filteredCommands.length > MAX_VISIBLE_COMMANDS
            ? `${t("commands.navigation")} (${windowStart + visibleCommands.length}/${filteredCommands.length})`
            : t("commands.navigation")}
        </Text>
      </Box>
    </Box>
  );
};

export { SlashCommandUI };
