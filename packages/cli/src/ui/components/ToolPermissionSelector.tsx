import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { ToolCallTitle } from "src/tools/ToolCallTitle.js";

import { t } from "../../i18n/index.js";
import { ToolCallPreview } from "../../tools/types.js";
import { theme } from "../theme/tokens.js";

import { ToolPreview } from "./ToolPreview.js";

// show dangerous commmand warning only once per CLI process
let hasShownDangerousCommandWarning = false;

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
 * on one row, its command behind a `|` guide, the choices below. A permission
 * request replaces the composer, so it never needs a frame of its own and the
 * transcript above it keeps the reader's place.
 */
export const ToolPermissionSelector: React.FC<ToolPermissionSelectorProps> = ({
  toolName,
  toolArgs,
  requestId,
  toolCallPreview,
  hasDynamicEvaluation = false,
  onResponse,
}) => {
  const permissionOptions = getPermissionOptions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialHasShownDangerousCommand] = useState(
    hasShownDangerousCommandWarning,
  );
  hasShownDangerousCommandWarning = false;
  const showDynamicWarning =
    hasDynamicEvaluation && !initialHasShownDangerousCommand;

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
        <Text color={theme.status.warning}>●</Text>
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
        borderColor={theme.border.default}
      >
        <ToolPreview
          toolName={toolName}
          toolArgs={toolArgs}
          toolCallPreview={toolCallPreview}
        />
        {showDynamicWarning && (
          <Text color={theme.status.warning} dimColor>
            {t("permission.note")}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text color={theme.text.primary} bold>
          {t("permission.prompt")}
        </Text>

        {permissionOptions.map((option, index) => {
          const isSelected = index === selectedIndex;

          return (
            <Box key={option.id} marginTop={index === 0 ? 1 : 0}>
              <Text color={isSelected ? theme.accent : theme.text.primary}>
                {isSelected ? "❯ " : "  "}
                {index + 1}. {option.name}
              </Text>
              <Text color={theme.text.secondary} dimColor>
                {"  "}
                {option.shortcut}
              </Text>
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text color={theme.text.secondary} dimColor>
            {t("permission.hint")}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
