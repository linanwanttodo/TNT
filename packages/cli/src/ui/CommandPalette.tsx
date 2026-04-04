import type { AssistantConfig } from "@tnt/sdk";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { t } from "../i18n/index.js";

import { getAllSlashCommands, type SlashCommand } from "./commands/index.js";
import { useTheme } from "./theme/tokens.js";

/**
 * Every command the session can run, reachable without remembering its name.
 *
 * The `/` picker already lists commands while the composer has a slash typed.
 * This is the same list without that prerequisite: `Ctrl+P` from anywhere in the
 * chat, a filter that matches the name or the description, and Enter which runs
 * the command through the same path typing it would take.
 *
 * Running is deliberately not re-implemented here: the palette hands the command
 * back as `/name`, so argument prompts, confirmations and side effects are the
 * ones the command already has.
 */
const MAX_VISIBLE = 8;

const FALLBACK_COMMANDS: SlashCommand[] = [
  { name: "help", description: t("cmd.help"), category: "system" },
  { name: "clear", description: t("cmd.clear"), category: "system" },
  { name: "exit", description: t("cmd.exit"), category: "system" },
];

export function filterPaletteCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) {
    return commands;
  }
  return commands.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) ||
      command.description.toLowerCase().includes(needle),
  );
}

export interface CommandPaletteProps {
  assistant?: AssistantConfig;
  /** Receives the command as `/name`, exactly as if it had been typed. */
  onRun: (command: string) => void;
  onCancel: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  assistant,
  onRun,
  onCancel,
}) => {
  const theme = useTheme();
  const [commands, setCommands] = useState<SlashCommand[]>(FALLBACK_COMMANDS);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!assistant) {
      return;
    }
    let stale = false;
    getAllSlashCommands(assistant)
      .then((loaded) => {
        if (!stale) {
          setCommands(loaded);
        }
      })
      .catch(() => {
        // The fallback list stays; a palette that opens empty is worse than one
        // that shows the three commands every session has.
      });
    return () => {
      stale = true;
    };
  }, [assistant]);

  const matches = useMemo(
    () => filterPaletteCommands(commands, filter),
    [commands, filter],
  );
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  const first = Math.max(
    0,
    Math.min(index - MAX_VISIBLE + 1, matches.length - MAX_VISIBLE),
  );
  const window = matches.slice(
    Math.max(0, first),
    Math.max(0, first) + MAX_VISIBLE,
  );

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }
    if (key.return) {
      const chosen = matches[index];
      if (chosen) {
        onRun(`/${chosen.name}`);
      }
      return;
    }
    if (key.upArrow) {
      setSelected(Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(Math.min(matches.length - 1, index + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((current) => current.slice(0, -1));
      setSelected(0);
      return;
    }
    // A paste arrives as one chunk; so does a fast two-key write in a test.
    if (!key.ctrl && !key.meta && /^[^\x00-\x1f]+$/.test(input)) {
      setFilter((current) => current + input);
      setSelected(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={theme.accent} bold>
          {t("palette.title")}
        </Text>
        <Box marginLeft={1}>
          <Text color={theme.text.subtle} dimColor>
            {t("palette.filter")}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.text.primary}>
          {"> "}
          {filter}
          <Text color={theme.accent}>|</Text>
        </Text>
      </Box>

      {matches.length === 0 ? (
        <Box marginTop={1}>
          <Text color={theme.text.subtle} dimColor>
            {t("palette.empty")}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {window.map((command, offset) => {
            const position = Math.max(0, first) + offset;
            const isSelected = position === index;
            return (
              <Box key={command.name}>
                <Text color={isSelected ? theme.accent : theme.text.primary}>
                  {isSelected ? "❯ " : "  "}
                  {command.name}
                </Text>
                <Box marginLeft={1}>
                  <Text color={theme.text.secondary} dimColor>
                    {command.description}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.text.subtle} dimColor>
          {t("palette.hint")}
        </Text>
      </Box>
    </Box>
  );
};
