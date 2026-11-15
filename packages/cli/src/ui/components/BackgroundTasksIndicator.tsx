import { Box, Text, type DOMElement } from "ink";
import React, { useRef } from "react";
import { useSyncExternalStore } from "react";

import type { BackgroundJobKind } from "../../services/BackgroundJobService.js";
import { backgroundJobService } from "../../services/BackgroundJobService.js";
import { useClickRegion } from "../hooks/useClickRegion.js";

/** One word per job kind, the way the footer names a group of them. */
const KIND_LABEL: Record<BackgroundJobKind, string> = {
  shell: "shell",
  monitor: "monitor",
  polled: "editor terminal",
};

/**
 * The clickable footer text for the running jobs, collapsed per kind: one
 * job is `1 shell`, several of a kind are `N shells`, mixed kinds join with
 * a separator (`1 shell · 1 monitor`).
 */
export function jobsFooterText(counts: Map<BackgroundJobKind, number>): string {
  return Array.from(counts.entries())
    .map(([kind, count]) => {
      const label = KIND_LABEL[kind];
      return count === 1 ? `1 ${label}` : `${count} ${label}s`;
    })
    .join(" · ");
}

function useRunningJobs(): ReturnType<
  typeof backgroundJobService.getRunningJobs
> {
  useSyncExternalStore(
    (listener) => backgroundJobService.subscribe(listener),
    () => backgroundJobService.getVersion(),
  );
  return backgroundJobService.getRunningJobs();
}

/**
 * The footer line in the transcript body while background work runs - the
 * `↳ N background tasks` row the reference CLI prints under the newest
 * message. It names nothing per job; the detail lives in the job list.
 */
const BackgroundTasksNotice: React.FC = () => {
  const running = useRunningJobs();
  if (running.length === 0) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      <Text dimColor>↳ </Text>
      <Text color="cyan">
        {running.length} background task{running.length === 1 ? "" : "s"}
      </Text>
      <Text dimColor> · /jobs to view</Text>
    </Box>
  );
};

/**
 * The clickable `1 shell` segment in the status row under the input box.
 * Clicking it opens the job list, where a job's output and its `x`-to-stop
 * live.
 */
const JobsFooterSegment: React.FC<{ onOpenJobs: () => void }> = ({
  onOpenJobs,
}) => {
  const running = useRunningJobs();
  const ref = useRef<DOMElement>(null);
  useClickRegion(ref, onOpenJobs);

  if (running.length === 0) {
    return null;
  }

  const counts = new Map<BackgroundJobKind, number>();
  for (const job of running) {
    counts.set(job.kind, (counts.get(job.kind) ?? 0) + 1);
  }

  return (
    <Box ref={ref} flexShrink={0}>
      <Text color="cyan">{jobsFooterText(counts)}</Text>
    </Box>
  );
};

export { BackgroundTasksNotice, JobsFooterSegment };
