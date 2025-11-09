import path from "path";

import { Box, Text } from "ink";
import React from "react";

import { getToolDisplayName } from "src/tools/index.js";

import { t } from "../i18n/index.js";
import { getCurrentSession } from "../session/index.js";
import {
  MARKER_FILE_CREATED,
  MARKER_PERMISSION_DENIED,
} from "../tools/resultMarkers.js";

import { ColoredDiff } from "./ColoredDiff.js";
import { ChecklistDisplay } from "./components/ChecklistDisplay.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import {
  blockLineBudget,
  blockOverflowNotice,
  planBlock,
} from "./utils/blockBudget.js";

const TODO_DETAILS_PREFIX = "tnt-todo:";
const MAX_TODO_PREVIEW = 5;

/**
 * The todo tool stores a machine-readable payload after the human readable
 * line so the todo state can be rebuilt from history. Only the first line is
 * shown in the transcript, plus at most five list entries.
 */
function todoSummaryLine(content: string): string {
  const markerIndex = content.indexOf(TODO_DETAILS_PREFIX);
  if (markerIndex === -1) {
    return content;
  }
  const readable = content.slice(0, markerIndex).trimEnd();
  const payload = content.slice(markerIndex + TODO_DETAILS_PREFIX.length);

  try {
    const details = JSON.parse(payload) as {
      todos?: { id: number; text: string; done: boolean }[];
    };
    const todos = details.todos ?? [];
    if (todos.length === 0) {
      return readable;
    }
    const done = todos.filter((todo) => todo.done).length;
    const preview = todos
      .slice(0, MAX_TODO_PREVIEW)
      .map((todo) => `${todo.done ? "✓" : "○"} #${todo.id} ${todo.text}`)
      .join("\n");
    const overflow =
      todos.length > MAX_TODO_PREVIEW
        ? `\n… ${todos.length - MAX_TODO_PREVIEW} more`
        : "";
    return `${readable} (${done}/${todos.length})\n${preview}${overflow}`;
  } catch {
    return readable;
  }
}

interface ToolResultSummaryProps {
  toolName?: string;
  content: string;
}

const ToolResultSummary: React.FC<ToolResultSummaryProps> = ({
  toolName,
  content,
}) => {
  // Read before the early returns: a budget has to exist for every block, and a
  // hook cannot sit behind one.
  const { rows } = useTerminalSize();
  const budget = blockLineBudget(rows);

  if (!content) {
    return (
      <Box>
        <Text color="dim">⎿ </Text>
        <Text color="dim"> No output</Text>
      </Box>
    );
  }

  const lines = content.split("\n").length;
  const chars = content.length;
  const displayName = toolName ? getToolDisplayName(toolName) : "Tool";

  // Handle Checklist specially with styled display
  if (toolName === "Checklist") {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="dim">⎿ </Text>
          <Text color="blue">Task List Updated</Text>
        </Box>
        <ChecklistDisplay content={t("tool.taskListStatus", { content })} />
      </Box>
    );
  }

  if (toolName === "Todo") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="dim">⎿ </Text>
          <Text color="blue">{todoSummaryLine(content)}</Text>
        </Box>
      </Box>
    );
  }

  // Handle Write/Edit/MultiEdit with diff specially
  if (
    (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") &&
    content.includes("Diff:\n")
  ) {
    const diffSection = content.split("Diff:\n")[1];
    if (diffSection) {
      return (
        <Box flexDirection="column">
          <Box>
            <Text color="dim">⎿ </Text>
            <Text color="green">
              {toolName === "Edit"
                ? " File edited successfully"
                : toolName === "MultiEdit"
                  ? " File edited successfully"
                  : " File written successfully"}
            </Text>
          </Box>
          <ColoredDiff diffContent={diffSection} />
        </Box>
      );
    }
  }

  // Handle terminal command output specially
  if (toolName === "Bash") {
    const isStderr = content.startsWith("Stderr:");
    const actualOutput = isStderr ? content.slice(7).trim() : content;
    const { shown, overflow } = planBlock(actualOutput.split("\n"), budget);
    const notice = blockOverflowNotice({
      sessionId: getCurrentSession().sessionId,
      toolName,
      overflow,
    });

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="dim">⎿ </Text>
          <Text color="dim"> Terminal output:</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={isStderr ? "red" : "white"}>
            {shown.join("\n").trimEnd()}
          </Text>
        </Box>
        {overflow.length > 0 && (
          <Box paddingLeft={2}>
            <Text color="dim">{notice ?? `... +${overflow.length} lines`}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // show streaming output for subagent tool output
  // Not put on the block budget: this block shows the tail of a run that is
  // still going, so the newest lines are the point and a head cut would hide them.
  if (toolName === "Subagent") {
    const metadataIndex = content.indexOf("<task_metadata>");
    const actualOutput =
      metadataIndex >= 0 ? content.slice(0, metadataIndex).trim() : content;

    if (!actualOutput) {
      return (
        <Box>
          <Text color="dim">⎿ </Text>
          <Text color="dim"> Subagent executing...</Text>
        </Box>
      );
    }

    const outputLines = actualOutput.split("\n");
    const MAX_TASK_OUTPUT_LINES = 20;

    if (outputLines.length <= MAX_TASK_OUTPUT_LINES) {
      return (
        <Box flexDirection="column">
          <Box>
            <Text color="dim">⎿ </Text>
            <Text color="dim"> Subagent output:</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>{actualOutput.trimEnd()}</Text>
          </Box>
        </Box>
      );
    } else {
      const lastLines = outputLines.slice(-MAX_TASK_OUTPUT_LINES).join("\n");
      return (
        <Box flexDirection="column">
          <Box>
            <Text color="dim">⎿ </Text>
            <Text color="dim"> Subagent output:</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color="dim">
              ... +{outputLines.length - MAX_TASK_OUTPUT_LINES} lines
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>{lastLines.trimEnd()}</Text>
          </Box>
        </Box>
      );
    }
  }

  // Handle all other cases with text summary
  const getSummary = () => {
    // Check if this is a user cancellation first
    if (content === MARKER_PERMISSION_DENIED) {
      return t("tool.cancelled");
    }

    // Check if it was an error
    if (content.startsWith("Error")) {
      const lines = content.split("\n");
      return t("tool.errorSummary", {
        message: `${lines[0]}${lines.length > 1 ? "..." : ""}`,
      });
    }

    // Convert absolute paths to relative paths from workspace root
    const formatPath = (filePath: string) => {
      if (path.isAbsolute(filePath)) {
        const workspaceRoot = process.cwd();
        const relativePath = path.relative(workspaceRoot, filePath);
        return relativePath || filePath;
      }
      return filePath;
    };

    // Handle specific tool output formatting
    switch (toolName) {
      case "Read":
        // Try to extract file path from content if it contains line numbers
        if (content.includes("→")) {
          const pathMatch = content.match(/^(.+?):/);
          const filePath = pathMatch ? pathMatch[1] : "file";
          return t("tool.pathSummary", {
            name: displayName,
            path: formatPath(filePath),
            count: lines,
          });
        }
        return t("tool.outputSummary", { name: displayName, count: lines });

      case "Write":
        return content.includes(MARKER_FILE_CREATED)
          ? t("tool.fileCreated")
          : t("tool.fileUpdated");

      case "Edit":
        return t("tool.fileEdited");

      case "MultiEdit":
        return t("tool.fileEdited");

      case "List":
        return lines === 1
          ? t("tool.listedItem", { count: lines })
          : t("tool.listedItems", { count: lines });

      case "Search":
        return lines === 1
          ? t("tool.foundMatch", { count: lines })
          : t("tool.foundMatches", { count: lines });

      case "Diff":
        return `Diff output (${lines} lines)`;

      default:
        // Fallback for all tools using display name
        if (chars > 1000) {
          return `${displayName} output: ${lines} lines, ${chars} characters`;
        } else if (lines > 10) {
          return `${displayName} output: ${lines} lines`;
        } else {
          return content.slice(0, 100) + (content.length > 100 ? "..." : "");
        }
    }
  };

  return (
    <Box>
      <Text color="dim">⎿ </Text>
      <Text color="dim"> {getSummary()}</Text>
    </Box>
  );
};

export { ToolResultSummary };
