import { Text } from "ink";
import React from "react";

import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";
import { SERVICE_NAMES } from "src/services/types.js";
import { useServices } from "src/ui/hooks/useService.js";

import type { PermissionMode } from "../../permissions/types.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { composeTopBorder } from "../utils/borderLine.js";

interface ModeIndicatorProps {
  mode?: PermissionMode;
  borderColor?: React.ComponentProps<typeof Text>["color"];
}

interface Badge {
  label: string;
  color: React.ComponentProps<typeof Text>["color"];
}

const MODE_BADGE: Record<PermissionMode, Badge> = {
  default: { label: "Manual", color: "white" },
  acceptEdits: { label: "Accept edits", color: "cyan" },
  plan: { label: "Plan", color: "blue" },
  auto: { label: "Auto", color: "green" },
  bypassPermissions: { label: "Bypass permissions", color: "red" },
  // dontAsk is headless/serve semantics and never reaches the TUI; the label
  // stays honest if a caller renders it anyway.
  dontAsk: { label: "Don't ask", color: "gray" },
};

export function modeBadge(mode: PermissionMode): Badge {
  return MODE_BADGE[mode] ?? MODE_BADGE.default;
}

/** The composer border follows the mode, under bash and remote priority. */
export function modeBorderColor(mode: PermissionMode): Badge["color"] {
  return modeBadge(mode).color;
}

/**
 * Renders the composer's top rule with the active mode embedded at the left
 * edge. Every mode has a badge, including Manual, so the line always says
 * which policy is in effect.
 */
const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode, borderColor }) => {
  const { services } = useServices<{
    toolPermissions: ToolPermissionServiceState;
  }>([SERVICE_NAMES.TOOL_PERMISSIONS]);
  const currentMode =
    mode ?? services.toolPermissions?.currentMode ?? "default";
  const { columns } = useTerminalSize();
  const badge = modeBadge(currentMode);
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
