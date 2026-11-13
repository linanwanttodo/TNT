import { Box, Text } from "ink";
import React from "react";

import {
  SERVICE_NAMES,
  UpdateServiceState,
  UpdateStatus,
} from "../services/types.js";
import { getVersion } from "../startup/version.js";

import { BrandBanner } from "./components/BrandBanner.js";
import { useServices } from "./hooks/useService.js";
import { useTheme } from "./theme/tokens.js";

/** Bar cells; the percentage is the number the reader can check it against. */
const BAR_CELLS = 18;

/**
 * The update runs under the wordmark, where the eye already is on entry. It
 * stays until the restarted process replaces this one, so a reader who looked
 * away still finds the outcome where the update started.
 */
const UpdateProgressRow: React.FC<{
  state: UpdateServiceState | undefined;
}> = ({ state }) => {
  const theme = useTheme();
  if (!state) return null;
  const updating = state.status === UpdateStatus.UPDATING;
  const updated = state.status === UpdateStatus.UPDATED;
  const failed = state.status === UpdateStatus.ERROR;
  if (!updating && !updated && !failed) return null;

  const percent = Math.max(0, Math.min(100, state.progress ?? 0));
  const filled = Math.round((percent / 100) * BAR_CELLS);
  const bar = `${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}`;
  const label = failed
    ? state.message
    : updated
      ? `${state.message} · ${state.currentVersion}`
      : `${state.message} · ${percent}%`;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        <Text color={failed ? theme.status.error : theme.status.running}>
          {bar}
        </Text>
        <Text color={theme.text.secondary}> {label}</Text>
      </Box>
      {updating ? (
        <Text color={theme.text.subtle}>restarting when it finishes</Text>
      ) : null}
    </Box>
  );
};

const IntroMessage: React.FC = () => {
  const { services } = useServices<{ update: UpdateServiceState }>([
    SERVICE_NAMES.UPDATE,
  ]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* The model and workspace are already in the status bar. */}
      <BrandBanner version={getVersion()} />
      <UpdateProgressRow state={services.update} />
      <Text> </Text>
    </Box>
  );
};

export { IntroMessage };
