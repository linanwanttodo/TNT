import { Box, Text, type DOMElement } from "ink";
import React, { useRef } from "react";
import { useSyncExternalStore } from "react";

import { backgroundJobService } from "../../services/BackgroundJobService.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { useTheme } from "../theme/tokens.js";

/**
 * The one-line footer of running background work, under the input box - the
 * same placement Claude Code gives its `↳ N background tasks` pill.
 *
 * The pill counts only live jobs, grouped the way a reader parses them: jobs
 * sharing one verb collapse into a single count (`2 shells`), a lone job names
 * itself (`monitor`), and anything else falls back to the total. Clicking the
 * pill - or pressing its key - opens the job list, where a job's output and
 * its `x`-to-stop live.
 */
const BackgroundTasksIndicator: React.FC<{
  onOpenJobs: () => void;
}> = ({ onOpenJobs }) => {
  const theme = useTheme();
  useSyncExternalStore(
    (listener) => backgroundJobService.subscribe(listener),
    () => backgroundJobService.getVersion(),
  );

  const running = backgroundJobService.getRunningJobs();
  if (running.length === 0) {
    return null;
  }

  const summary = summarizeJobs(running);
  const ref = useRef<DOMElement>(null);
  useClickRegion(ref, onOpenJobs);

  return (
    <Box paddingLeft={2}>
      <Text dimColor>↳ </Text>
      <Box ref={ref}>
        <Text backgroundColor={theme.accent} color="black" bold>
          {" "}
          {summary}{" "}
        </Text>
      </Box>
      <Text dimColor> (click to view)</Text>
    </Box>
  );
};

function summarizeJobs(
  running: ReturnType<typeof backgroundJobService.getRunningJobs>,
): string {
  if (running.length === 1) {
    return "1 background job";
  }
  const commands = running.map((job) => job.command.trim());
  const allSame = commands.every((command) => command === commands[0]);
  if (allSame) {
    return `${running.length}× ${commands[0]}`;
  }
  return `${running.length} background jobs`;
}

export { BackgroundTasksIndicator };
