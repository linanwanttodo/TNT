import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import type { PermissionMode } from "../../permissions/types.js";

import { modeBadge } from "./ModeIndicator.js";

export interface ModeMenuEntry {
  mode: PermissionMode;
  description: string;
}

/**
 * The modes Shift+Tab offers, in Claude's menu order. dontAsk is headless and
 * serve semantics and never appears; auto is listed but selecting it is
 * refused until its classifier exists.
 */
export const MODE_MENU_ENTRIES: ModeMenuEntry[] = [
  { mode: "default", description: t("mode.desc.default") },
  { mode: "acceptEdits", description: t("mode.desc.acceptEdits") },
  { mode: "plan", description: t("mode.desc.plan") },
  { mode: "auto", description: t("mode.desc.auto") },
  {
    mode: "bypassPermissions",
    description: t("mode.desc.bypassPermissions"),
  },
];

interface ModeMenuProps {
  /** The highlighted row; starts on the active mode. */
  selectedIndex: number;
  currentMode: PermissionMode;
}

const ModeMenu: React.FC<ModeMenuProps> = ({ selectedIndex, currentMode }) => {
  return (
    <Box paddingX={1} marginX={1} marginBottom={1} flexDirection="column">
      {MODE_MENU_ENTRIES.map((entry, index) => {
        const badge = modeBadge(entry.mode);
        const isSelected = index === selectedIndex;
        const isActive = entry.mode === currentMode;

        return (
          <Box key={entry.mode}>
            <Text color={isSelected ? "blue" : "white"} bold={isSelected}>
              {"  "}
              {`[${badge.label}]`.padEnd(22)}
              <Text color={isSelected ? "blue" : "gray"}>
                {entry.description}
                {isActive ? ` · ${t("mode.active")}` : ""}
              </Text>
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {t("mode.menuHint")}
        </Text>
      </Box>
    </Box>
  );
};

export { ModeMenu };
