import { Box, Text } from "ink";
import React, { useMemo } from "react";

import {
  SERVICE_NAMES,
  UpdateServiceState,
  UpdateStatus,
} from "../services/types.js";

import { useServices } from "./hooks/useService.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { LoadingAnimation } from "./LoadingAnimation.js";
import { useTheme } from "./theme/tokens.js";

interface UpdateNotificationProps {
  isRemoteMode?: boolean;
}
const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  isRemoteMode = false,
}) => {
  const { columns } = useTerminalSize();
  const theme = useTheme();

  const { services } = useServices<{
    update: UpdateServiceState;
  }>([SERVICE_NAMES.UPDATE]);

  const color = useMemo(() => {
    switch (services.update?.status) {
      case UpdateStatus.UPDATING:
        return theme.status.running;
      case UpdateStatus.UPDATED:
        return "green";
      case UpdateStatus.ERROR:
        return "red";
      default:
        return "dim";
    }
  }, [services.update?.status]);

  const text = useMemo(() => {
    if (!services.update?.message) {
      return "TNT";
    }

    return services.update.message;
  }, [columns, services.update?.message]);

  if (!services.update?.isUpdateAvailable && isRemoteMode) {
    return <Text color="cyan">◉ Remote Mode</Text>;
  }

  // The installed version is not a notice: the intro header carries it. The
  // badge appears only while an update is available or being applied, so the
  // status row ends at the model instead of at a version nobody asked for.
  const updateVisible =
    !!services.update?.isUpdateAvailable ||
    services.update?.status === UpdateStatus.UPDATING ||
    services.update?.status === UpdateStatus.UPDATED ||
    services.update?.status === UpdateStatus.ERROR;
  if (!updateVisible) {
    return null;
  }

  if (services.update?.status === UpdateStatus.UPDATING) {
    return (
      <Box columnGap={1}>
        <LoadingAnimation />
        <Text color={color}>{`${text}`}</Text>
      </Box>
    );
  }

  return <Text color={color}>{`◉ ${text}`}</Text>;
};

export { UpdateNotification };
