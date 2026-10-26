import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { ToolCallTitle } from "src/tools/ToolCallTitle.js";

import { t } from "../../i18n/index.js";
import { ToolCallPreview } from "../../tools/types.js";
import { useTheme } from "../theme/tokens.js";

import { ToolDiffView } from "./ToolDiffView.js";
import { isShellTool } from "./ToolGroupDisplay.js";
import { ToolPreview } from "./ToolPreview.js";

// show dangerous commmand warning only once per CLI process
let hasShownDangerousCommandWarning = false;

/** Rows of the change preview kept visible before the reader asks for more. */
const COLLAPSED_DIFF_LINES = 8;

interface PermissionOption {
  id: string;
  name: string;
  shortcut: string;
  approved: boolean;
  createPolicy?: boolean;
  forSession?: boolean;
  stopStream?: boolean;
}

interface ToolPermissionSelectorProps {
  toolName: string;
  toolArgs: any;
  requestId: string;
  toolCallPreview?: ToolCallPreview[];
  hasDynamicEvaluation?: boolean;
  onResponse: (
    requestId: string,
    approved: boolean,
    createPolicy?: boolean,
    stopStream?: boolean,
    forSession?: boolean,
  ) => void;
}

const getPermissionOptions = (): PermissionOption[] => {
  return [
    {
      id: "approve",
      name: t("permission.continue"),
      shortcut: "(enter)",
      approved: true,
    },
    {
      id: "approve_session",
      name: t("permission.continueThisSession"),
      shortcut: "(s)",
      approved: true,
      forSession: true,
    },
    {
      id: "approve_policy",
      name: t("permission.continueDontAsk"),
      shortcut: "(shift+tab)",
      approved: true,
      createPolicy: true,
    },
    {
      id: "deny_stop",
      name: t("permission.tellDifferently"),
      shortcut: "(esc)",
      approved: false,
      stopStream: true,
    },
  ];
};

/**
 * The approval prompt, in the same compact shape as the transcript: the call
 * on one row, the body hanging from a left guide, the choices below. A
 * permission request replaces the composer, so it never needs a frame of its
 * own and the transcript above it keeps the reader's place.
 *
 * The body follows the tool being approved. A shell call prints the whole
 * command verbatim, newlines and indentation included, over the working
 * directory it will run in. A change to a file renders the engine's diff
 * preview through the same diff view the transcript uses, folded to eight
 * rows that `e` expands and folds. Every other tool keeps the argument
 * preview the engine built.
 */
export const ToolPermissionSelector: React.FC<ToolPermissionSelectorProps> = ({
  toolName,
  toolArgs,
  requestId,
  toolCallPreview,
  hasDynamicEvaluation = false,
  onResponse,
}) => {
  const activeTheme = useTheme();
  const permissionOptions = getPermissionOptions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [initialHasShownDangerousCommand] = useState(
    hasShownDangerousCommandWarning,
  );
  hasShownDangerousCommandWarning = false;
  const showDynamicWarning =
    hasDynamicEvaluation && !initialHasShownDangerousCommand;

  const shellCommand =
    isShellTool(toolName) && typeof toolArgs?.command === "string"
      ? toolArgs.command
      : null;
  const diffContent = (toolCallPreview ?? [])
    .filter((preview) => preview.type === "diff")
    .map((preview) => preview.content)
    .join("\n\n");
  const isDiffCard = shellCommand === null && diffContent.length > 0;
  const textEntries = isDiffCard
    ? (toolCallPreview ?? []).filter((preview) => preview.type !== "diff")
    : undefined;

  const choose = (option: PermissionOption) => {
    onResponse(
      requestId,
      option.approved,
      option.createPolicy,
      option.stopStream,
      option.forSession,
    );
  };

  useInput((input, key) => {
    if (key.return) {
      choose(permissionOptions[selectedIndex]);
      return;
    }

    // Numbers pick a row directly, the way a list of choices is usually read.
    if (input >= "1" && input <= String(permissionOptions.length)) {
      const option = permissionOptions[Number(input) - 1];
      if (option) {
        choose(option);
      }
      return;
    }

    // Tab to continue (approve)
    if (key.tab && !key.shift) {
      onResponse(requestId, true, false, false);
      return;
    }

    // Shift+Tab to continue with policy creation
    if (key.tab && key.shift) {
      onResponse(requestId, true, true, false);
      return;
    }

    // Escape or Ctrl+C to reject with stop stream
    if (key.escape || (key.ctrl && input === "c")) {
      onResponse(requestId, false, false, true);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(
        Math.min(permissionOptions.length - 1, selectedIndex + 1),
      );
    }

    // The diff card folds to a few rows; e is the only free letter left.
    if (isDiffCard && input === "e") {
      setDiffExpanded((expanded) => !expanded);
      return;
    }

    // Also support y/n for quick responses
    if (input === "y" || input === "Y") {
      onResponse(requestId, true, false, false);
    } else if (input === "n" || input === "N") {
      onResponse(requestId, false, false, true);
    } else if (input === "s" || input === "S") {
      // Allow this exact call for the rest of the session, nothing written
      onResponse(requestId, true, false, false, true);
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={activeTheme.status.warning}>●</Text>
        <Box marginLeft={1} flexShrink={1} minWidth={0}>
          <ToolCallTitle toolName={toolName} args={toolArgs} />
        </Box>
      </Box>

      <Box
        flexDirection="column"
        marginLeft={2}
        paddingLeft={1}
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={activeTheme.border.default}
      >
        {shellCommand === null ? (
          isDiffCard ? (
            <Box flexDirection="column">
              <ToolPreview
                toolName={toolName}
                toolArgs={toolArgs}
                toolCallPreview={textEntries}
              />
              <Box marginTop={1}>
                <ToolDiffView
                  diffContent={diffContent}
                  expanded={diffExpanded}
                  collapsedLines={COLLAPSED_DIFF_LINES}
                  customTheme={activeTheme}
                />
              </Box>
              <Box marginTop={1}>
                <Text color={activeTheme.tool.hint} dimColor>
                  {t("permission.diffToggle")}
                </Text>
              </Box>
            </Box>
          ) : (
            <ToolPreview
              toolName={toolName}
              toolArgs={toolArgs}
              toolCallPreview={toolCallPreview}
            />
          )
        ) : (
          <Box flexDirection="column">
            <Text>{shellCommand}</Text>
            <Box marginTop={1}>
              <Text color={activeTheme.text.secondary} dimColor>
                {t("permission.workingDirectory")}: {process.cwd()}
              </Text>
            </Box>
          </Box>
        )}
        {showDynamicWarning && (
          <Text color={activeTheme.status.warning} dimColor>
            {t("permission.note")}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text color={activeTheme.text.primary} bold>
          {t("permission.prompt")}
        </Text>

        {permissionOptions.map((option, index) => {
          const isSelected = index === selectedIndex;

          return (
            <Box key={option.id} marginTop={index === 0 ? 1 : 0}>
              <Text
                color={
                  isSelected ? activeTheme.accent : activeTheme.text.primary
                }
              >
                {isSelected ? "❯ " : "  "}
                {index + 1}. {option.name}
              </Text>
              <Text color={activeTheme.text.secondary} dimColor>
                {"  "}
                {option.shortcut}
              </Text>
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text color={activeTheme.text.secondary} dimColor>
            {t("permission.hint")}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
