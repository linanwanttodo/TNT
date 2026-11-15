import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../i18n/index.js";
import {
  BackgroundJob,
  backgroundJobService,
} from "../services/BackgroundJobService.js";
import { truncateOutputFromStart } from "../utils/truncateOutput.js";

import { themedBoxStyles } from "./styles.js";
import { symbols } from "./symbols.js";
import { useTheme, type Theme } from "./theme/tokens.js";

interface JobsSelectorProps {
  onCancel: () => void;
}

type ViewMode = "list" | "detail";

function getStatusColor(theme: Theme, status: BackgroundJob["status"]): string {
  if (status === "running" || status === "pending") return theme.status.warning;
  if (status === "completed") return theme.status.success;
  return theme.status.error;
}

function formatDuration(job: BackgroundJob): string {
  const endTime = job.endTime ? job.endTime.getTime() : Date.now();
  return `${Math.round((endTime - job.startTime.getTime()) / 1000)}s`;
}

export function JobsSelector({ onCancel }: JobsSelectorProps) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedJob, setSelectedJob] = useState<BackgroundJob | null>(null);
  const [jobs, setJobs] = useState(() => backgroundJobService.getAllJobs());

  // Refetch the job details every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      if (viewMode === "detail" && selectedJob) {
        const freshJob = backgroundJobService.getJob(selectedJob.id);
        if (freshJob) {
          setSelectedJob(freshJob);
        }
      } else {
        setJobs(backgroundJobService.getAllJobs());
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [viewMode, selectedJob]);

  useInput((input, key) => {
    // Handle key input when viewing job details
    if (viewMode === "detail") {
      // Go back to list view
      if (key.escape || input === "b") {
        setViewMode("list");
        setSelectedJob(null);
        return;
      }
      // Cancel the selected job if it's still active
      if (input === "x" && selectedJob) {
        const job = backgroundJobService.getJob(selectedJob.id);
        if (job && (job.status === "running" || job.status === "pending")) {
          backgroundJobService.cancelJob(selectedJob.id);
        }
        return;
      }
      return;
    }

    // Handle key input when viewing job list
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    // Navigate up and down the job list
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : jobs.length - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < jobs.length - 1 ? prev + 1 : 0));
      return;
    }

    // Select a job to view its details
    if (key.return && jobs[selectedIndex]) {
      setSelectedJob(jobs[selectedIndex]);
      setViewMode("detail");
      return;
    }
  });

  if (jobs.length === 0) {
    return (
      <Box {...themedBoxStyles(theme)}>
        <Text color={theme.accent} bold>
          Background Jobs
        </Text>
        <Text> </Text>
        <Text color={theme.text.secondary}>{t("jobs.none")}</Text>
        <Text> </Text>
        <Text color={theme.text.secondary}>{t("jobs.backHint")}</Text>
      </Box>
    );
  }

  if (viewMode === "detail" && selectedJob) {
    const freshJob = selectedJob;
    const { output: lastOutput } = truncateOutputFromStart(freshJob.output, {
      maxLines: 10,
      maxChars: 2000,
    });

    return (
      <Box {...themedBoxStyles(theme)} flexDirection="column">
        <Text color={theme.accent} bold>
          Job Details
        </Text>
        <Text color={theme.text.secondary}>{t("jobs.listHint")}</Text>
        <Text> </Text>

        <Box flexDirection="row" gap={1}>
          <Text color={theme.text.secondary}>ID:</Text>
          <Text color={theme.border.focus}>{freshJob.id}</Text>
        </Box>

        <Box flexDirection="row" gap={1}>
          <Text color={theme.text.secondary}>{t("jobs.status")}</Text>
          <Text color={getStatusColor(theme, freshJob.status)}>
            {freshJob.status}
          </Text>
        </Box>

        <Box flexDirection="row" gap={1}>
          <Text color={theme.text.secondary}>{t("jobs.duration")}</Text>
          <Text>{formatDuration(freshJob)}</Text>
        </Box>

        <Box flexDirection="row" gap={1}>
          <Text color={theme.text.secondary}>{t("jobs.command")}</Text>
          <Text>{freshJob.command}</Text>
        </Box>

        {freshJob.exitCode !== null && (
          <Box flexDirection="row" gap={1}>
            <Text color={theme.text.secondary}>{t("jobs.exitCode")}</Text>
            <Text
              color={
                freshJob.exitCode === 0
                  ? theme.status.success
                  : theme.status.error
              }
            >
              {freshJob.exitCode}
            </Text>
          </Box>
        )}

        {freshJob.error && (
          <Box flexDirection="row" gap={1}>
            <Text color={theme.text.secondary}>{t("jobs.error")}</Text>
            <Text color={theme.status.error}>{freshJob.error}</Text>
          </Box>
        )}

        <Text> </Text>
        <Text color={theme.text.secondary}>{t("jobs.outputTail")}</Text>
        <Box
          borderStyle="single"
          borderColor={theme.border.default}
          paddingX={1}
        >
          <Text>{lastOutput || "(no output)"}</Text>
        </Box>
      </Box>
    );
  }

  // List screen
  return (
    <Box {...themedBoxStyles(theme)}>
      <Text color={theme.accent} bold>
        Background Jobs ({jobs.length})
      </Text>
      <Text color={theme.text.secondary}>
        ↑/↓ to navigate, Enter to view details, Esc to exit
      </Text>
      <Text> </Text>

      {jobs.map((job, index) => {
        const isSelected = index === selectedIndex;
        const prefix = isSelected ? `${symbols().selected} ` : "  ";

        return (
          <Box key={job.id} flexDirection="row" gap={1}>
            <Text color={isSelected ? theme.border.focus : undefined}>
              {prefix}
            </Text>
            <Text color={getStatusColor(theme, job.status)}>
              {job.status.padEnd(10)}
            </Text>
            <Text color={theme.border.focus}>{job.id}</Text>
            <Text color={theme.text.secondary}>({formatDuration(job)})</Text>
            <Text>
              {job.command.substring(0, 30)}
              {job.command.length > 30 ? "..." : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
