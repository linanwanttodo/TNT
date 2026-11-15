import { Text } from "ink";
import React from "react";

import type { PermissionMode } from "../../permissions/types.js";
import { ToolPermissionServiceState } from "../../services/ToolPermissionService.js";
import { SERVICE_NAMES } from "../../services/types.js";
import { useServices } from "../hooks/useService.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { darkTheme, useTheme, type Theme } from "../theme/tokens.js";
import { composeTopBorder } from "../utils/borderLine.js";

interface ModeIndicatorProps {
  mode?: PermissionMode;
  borderColor?: React.ComponentProps<typeof Text>["color"];
}

interface Badge {
  label: string;
  color: React.ComponentProps<typeof Text>["color"];
}

const MODE_BADGE: Record<
  PermissionMode,
  { label: string; color: (theme: Theme) => string }
> = {
  default: { label: "Manual", color: (theme) => theme.text.primary },
  acceptEdits: { label: "Accept edits", color: (theme) => theme.border.focus },
  plan: { label: "Plan", color: (theme) => theme.accent },
  auto: { label: "Auto", color: (theme) => theme.status.success },
  bypassPermissions: {
    label: "Bypass permissions",
    color: (theme) => theme.status.error,
  },
  // dontAsk is headless/serve semantics and never reaches the TUI; the label
  // stays honest if a caller renders it anyway.
  dontAsk: { label: "Don't ask", color: (theme) => theme.text.secondary },
};

export function modeBadge(
  mode: PermissionMode,
  theme: Theme = darkTheme,
): Badge {
  const badge = MODE_BADGE[mode] ?? MODE_BADGE.default;
  return { label: badge.label, color: badge.color(theme) };
}

/** The composer border follows the mode, under bash and remote priority. */
export function modeBorderColor(
  mode: PermissionMode,
  theme: Theme = darkTheme,
): Badge["color"] {
  return modeBadge(mode, theme).color;
}

/**
 * Renders the composer's top rule with the active mode embedded at the left
 * edge. Every mode has a badge, including Manual, so the line always says
 * which policy is in effect.
 */
const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode, borderColor }) => {
  const theme = useTheme();
  const { services } = useServices<{
    toolPermissions: ToolPermissionServiceState;
  }>([SERVICE_NAMES.TOOL_PERMISSIONS]);
  const currentMode = mode ?? services.toolPermissions?.currentMode ?? "auto";
  const { columns } = useTerminalSize();
  const badge = modeBadge(currentMode, theme);
  const lineColor = borderColor ?? badge.color;

  const { prefix, label, suffix } = composeTopBorder(
    columns,
    `[${badge.label}]`,
  );

  return (
    <Text>
      <Text color={lineColor}>{prefix}</Text>
      <Text color={badge.color} bold>
        {label}
      </Text>
      <Text color={lineColor}>{suffix}</Text>
    </Text>
  );
};

export { ModeIndicator };
