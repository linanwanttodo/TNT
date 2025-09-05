import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { ToolCallTitle } from "src/tools/ToolCallTitle.js";

import { ToolCallPreview } from "../../tools/types.js";
import { defaultBoxStyles } from "../styles.js";

import { ToolPreview } from "./ToolPreview.js";
import { t } from "../../i18n/index.js";

// show dangerous commmand warning only once per CLI process
let hasShownDangerousCommandWarning = false;

interface PermissionOption {
  id: string;
  name: string;
  color: string;
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
      color: "green",
      approved: true,
    },
    {
      id: "approve_session",
      name: t("permission.continueThisSession"),
      color: "blue",
      approved: true,
      forSession: true,
    },
    {
      id: "approve_policy",
      name: t("permission.continueDontAsk"),
      color: "cyan",
      approved: true,
      createPolicy: true,
    },
    {
      id: "deny_stop",
      name: t("permission.tellDifferently"),
      color: "yellow",
      approved: false,
      stopStream: true,
    },
  ];
};

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

  useInput((input, key) => {
    if (key.return) {
      const selectedOption = permissionOptions[selectedIndex];
      onResponse(
        requestId,
        selectedOption.approved,
        selectedOption.createPolicy,
        selectedOption.stopStream,
        selectedOption.forSession,
      );
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
    <Box {...defaultBoxStyles("magenta")}>
      <Text color="magenta" bold>
        <ToolCallTitle toolName={toolName} args={toolArgs} />
      </Text>

      {/* Show preview of what the tool will do */}
      <Box>
        <ToolPreview
          toolName={toolName}
          toolArgs={toolArgs}
          toolCallPreview={toolCallPreview}
        />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="dim">{t("permission.prompt")}</Text>
        {showDynamicWarning && (
          <Box marginTop={1}>
            <Text color="yellow" dimColor>
              Note: Dangerous commands will be blocked regardless of your
              preference.
            </Text>
          </Box>
        )}
        {permissionOptions.map((option, index) => {
          const isSelected = index === selectedIndex;
          let shortcut = "";
          if (option.id === "approve") shortcut = "(tab)";
          else if (option.id === "approve_session") shortcut = "(s)";
          else if (option.id === "approve_policy") shortcut = "(shift+tab)";
          else if (option.id === "deny_stop") shortcut = "(esc)";

          return (
            <Box key={option.id} marginTop={index === 0 ? 1 : 0}>
              <Text
                color={isSelected ? option.color : "white"}
                bold={isSelected}
              >
                {isSelected ? "> " : "  "}
                {option.name}
              </Text>
              <Text color="gray" dimColor>
                {" "}
                {shortcut}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
