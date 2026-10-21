import { type AssistantConfig } from "@tnt/sdk";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../i18n/index.js";

import { getAllSlashCommands, type SlashCommand } from "./commands/index.js";
import { useLocale } from "./hooks/useLocale.js";

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
  filter: string;
  selectedIndex: number;
}

/** How many commands show at once, like Pi's autocomplete window. */
const MAX_VISIBLE_COMMANDS = 5;

const SlashCommandUI: React.FC<SlashCommandUIProps> = ({
  assistant,
  commands,
  filter,
  selectedIndex,
}) => {
  const locale = useLocale();
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

  return (
    <Box paddingX={1} marginX={1} marginBottom={1} flexDirection="column">
      {visibleCommands.map((command, index) => {
        const isSelected = windowStart + index === selectedIndex;

        // Find the longest command name to vertically align command descriptions
        const maxCommandLength = Math.max(
          ...visibleCommands.map((cmd) => cmd.name.length),
        );
        const paddedCommandName = `/${command.name}`.padEnd(
          maxCommandLength + 1,
        );

        return (
          <Box key={command.name}>
            <Text color={isSelected ? "blue" : "white"} bold={isSelected}>
              {"  "}
              {paddedCommandName}
              <Text color={isSelected ? "blue" : "gray"}>
                {"    "}
                {truncateDescription(command.description)}
              </Text>
            </Text>
          </Box>
        );
      })}

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
