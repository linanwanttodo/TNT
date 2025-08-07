import { type AssistantConfig } from "@tnt/sdk";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { getAllSlashCommands, type SlashCommand } from "../slash/index.js";
import { t } from "../i18n/index.js";
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
  filter: string;
  selectedIndex: number;
}

const SlashCommandUI: React.FC<SlashCommandUIProps> = ({
  assistant,
  filter,
  selectedIndex,
}) => {
  const locale = useLocale();
  const [allCommands, setAllCommands] = useState<SlashCommand[]>(
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
    let stale = false;

    const loadCommands = async () => {
      if (assistant) {
        const commands = await getAllSlashCommands(assistant);
        if (!stale) {
          setAllCommands(commands);
        }
      }
    };

    void loadCommands();

    return () => {
      stale = true;
    };
  }, [assistant?.prompts, assistant?.rules, locale]);

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

  return (
    <Box paddingX={1} marginX={1} marginBottom={1} flexDirection="column">
      {filteredCommands.map((command, index) => {
        const isSelected = index === selectedIndex;

        // Find the longest command name to vertically align command descriptions
        const maxCommandLength = Math.max(
          ...filteredCommands.map((cmd) => cmd.name.length),
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
          {t("commands.navigation")}
        </Text>
      </Box>
    </Box>
  );
};

export { SlashCommandUI };
