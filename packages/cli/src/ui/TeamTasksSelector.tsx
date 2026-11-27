import type { TeamTaskView } from "core/index.js";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  getCurrentTeamRunId,
  getSessionTeamRuns,
  listTeamTasks,
  subscribeTeamRunChanges,
} from "../session/index.js";
import { taskUpdateTool } from "../tools/teamTasks.js";

import { themedBoxStyles } from "./styles.js";
import { useTheme, type Theme } from "./theme/tokens.js";

interface TeamTasksSelectorProps {
  onCancel: () => void;
}

function statusColor(theme: Theme, task: TeamTaskView): string {
  if (task.status === "completed") return theme.status.success;
  if (task.status === "in_progress") return theme.status.warning;
  return task.blocked ? theme.text.subtle : theme.text.secondary;
}

export function TeamTasksSelector({ onCancel }: TeamTasksSelectorProps) {
  const theme = useTheme();
  const [runId] = useState(() => getCurrentTeamRunId());
  const [tasks, setTasks] = useState<TeamTaskView[]>(() =>
    runId ? listTeamTasks(runId) : [],
  );
  const [members, setMembers] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [memberIndex, setMemberIndex] = useState(0);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    if (!runId) return;
    setTasks(listTeamTasks(runId));
    setMembers(
      getSessionTeamRuns()
        .find((run) => run.runId === runId)
        ?.members.map((member) => member.name) ?? [],
    );
  }, [runId]);

  useEffect(() => {
    refresh();
    return subscribeTeamRunChanges(refresh);
  }, [refresh]);

  const selected = tasks[selectedIndex];
  const owner = members[memberIndex] ?? "lead";
  const canUpdate = Boolean(
    selected && !selected.blocked && selected.status !== "completed",
  );

  const updateSelected = useCallback(
    async (status: "in_progress" | "completed") => {
      if (!runId || !selected || !canUpdate || busy) return;
      setBusy(true);
      setMessage("");
      try {
        const result = await taskUpdateTool.run({
          task_id: selected.taskId,
          status,
          owner,
        });
        const text = typeof result === "string" ? result : result.content;
        setMessage(text);
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [runId, selected, canUpdate, busy, owner, refresh],
  );

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || (key.ctrl && input === "c")) {
      if (detail) setDetail(false);
      else onCancel();
      return;
    }
    if (detail && selected) {
      if (input === "b") {
        setDetail(false);
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        if (members.length > 0) {
          const delta = key.leftArrow ? -1 : 1;
          setMemberIndex(
            (current) => (current + delta + members.length) % members.length,
          );
        }
        return;
      }
      if (input === " ") {
        void updateSelected("in_progress");
        return;
      }
      if (input === "c") {
        void updateSelected("completed");
        return;
      }
      return;
    }
    if (tasks.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex(
        (current) => (current - 1 + tasks.length) % tasks.length,
      );
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % tasks.length);
      return;
    }
    if (input === "r") {
      refresh();
      setMessage("Refreshed.");
      return;
    }
    if (key.return) setDetail(true);
  });

  const summary = useMemo(() => {
    const completed = tasks.filter(
      (task) => task.status === "completed",
    ).length;
    const active = tasks.filter((task) => task.status === "in_progress").length;
    return `${completed}/${tasks.length} completed, ${active} active`;
  }, [tasks]);

  if (!runId) {
    return (
      <Box {...themedBoxStyles(theme)} flexDirection="column">
        <Text color={theme.accent} bold>
          Team Tasks
        </Text>
        <Text color={theme.text.secondary}>No active team run.</Text>
        <Text color={theme.text.subtle}>Esc to return</Text>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box {...themedBoxStyles(theme)} flexDirection="column">
        <Text color={theme.accent} bold>
          Team Tasks
        </Text>
        <Text color={theme.text.secondary}>No tasks in this team run.</Text>
        <Text color={theme.text.subtle}>r to refresh, Esc to return</Text>
      </Box>
    );
  }

  if (detail && selected) {
    return (
      <Box {...themedBoxStyles(theme)} flexDirection="column">
        <Text color={theme.accent} bold>
          Team Task
        </Text>
        <Text color={theme.text.secondary}>{summary}</Text>
        <Text> </Text>
        <Text bold>{selected.subject}</Text>
        <Text color={theme.text.secondary}>ID: {selected.taskId}</Text>
        <Text color={statusColor(theme, selected)}>
          {selected.status}
          {selected.blocked ? " (blocked)" : ""}
        </Text>
        <Text>Owner: {selected.owner ?? "unassigned"}</Text>
        {selected.dependsOn.length > 0 && (
          <Text>Depends on: {selected.dependsOn.join(", ")}</Text>
        )}
        {selected.description && (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text.secondary}>Description</Text>
            <Text>{selected.description}</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text>Act as: {owner} (left/right to choose)</Text>
          <Text color={theme.text.subtle}>
            Space to claim, c to complete, b/Esc to return
          </Text>
          {selected.blocked && (
            <Text color={theme.status.warning}>
              Complete the dependencies before changing this task.
            </Text>
          )}
          {message && <Text color={theme.text.secondary}>{message}</Text>}
        </Box>
      </Box>
    );
  }

  return (
    <Box {...themedBoxStyles(theme)} flexDirection="column">
      <Text color={theme.accent} bold>
        Team Tasks
      </Text>
      <Text color={theme.text.secondary}>{summary}</Text>
      <Text color={theme.text.subtle}>
        Up/Down to navigate, Enter for details, r to refresh, Esc to return
      </Text>
      <Text> </Text>
      {tasks.map((task, index) => (
        <Box key={task.taskId} flexDirection="row" gap={1}>
          <Text
            color={index === selectedIndex ? theme.border.focus : undefined}
          >
            {index === selectedIndex ? "> " : "  "}
          </Text>
          <Text color={statusColor(theme, task)}>{task.status.padEnd(11)}</Text>
          <Text bold={index === selectedIndex}>{task.subject}</Text>
          {task.owner && <Text color={theme.text.subtle}>@{task.owner}</Text>}
          {task.blocked && <Text color={theme.status.warning}>blocked</Text>}
        </Box>
      ))}
      {message && <Text color={theme.text.secondary}>{message}</Text>}
    </Box>
  );
}
