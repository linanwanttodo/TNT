import { Text } from "ink";
import React from "react";

import { useServices } from "src/hooks/useService.js";
import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";
import { SERVICE_NAMES } from "src/services/types.js";

import type { PermissionMode } from "../../permissions/types.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { composeTopBorder } from "../utils/borderLine.js";

interface ModeIndicatorProps {
  mode?: PermissionMode;
  borderColor?: React.ComponentProps<typeof Text>["color"];
}

/**
 * Renders the composer's top rule with the active mode embedded at the left
 * edge. Returns nothing for the default mode so the composer keeps its plain
 * border when no mode override is in effect.
 */
const ModeIndicator: React.FC<ModeIndicatorProps> = ({
  mode,
  borderColor = "gray",
}) => {
  const { services } = useServices<{
    toolPermissions: ToolPermissionServiceState;
  }>([SERVICE_NAMES.TOOL_PERMISSIONS]);
  const currentMode = mode ?? services.toolPermissions?.currentMode ?? "agent";
  const { columns } = useTerminalSize();

  if (currentMode === "agent") {
    return null;
  }

  const { prefix, label, suffix } = composeTopBorder(
    columns,
    `[${currentMode}]`,
  );
  const modeColor = currentMode === "plan" ? "blue" : "green";

  return (
    <Text>
      <Text color={borderColor}>{prefix}</Text>
      <Text color={modeColor} bold>
        {label}
      </Text>
      <Text color={borderColor}>{suffix}</Text>
    </Text>
  );
};

export { ModeIndicator };
