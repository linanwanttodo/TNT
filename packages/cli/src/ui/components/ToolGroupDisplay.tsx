import { Box, Text, type DOMElement } from "ink";
import React, {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { ToolCallState } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import { formatToolArgument } from "../../tools/formatters.js";
import { getToolDisplayName } from "../../tools/registry.js";
import { markLayoutDirty } from "../hooks/layoutDirty.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { useTheme, type Theme } from "../theme/tokens.js";

import {
  getDiffSummary,
  isDiffContent,
  parseDiffLines,
  separateDiffAndNotes,
  ToolDiffView,
} from "./ToolDiffView.js";

/** Shell tools read as `$ command`. */
const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "terminal",
  "exec",
  "powershell",
]);

export function isShellTool(displayName: string): boolean {
  return SHELL_TOOLS.has(displayName.toLowerCase());
}

/** Rows of output kept in the collapsed view. The tail is what a failure is. */
const COLLAPSED_OUTPUT_LINES = 4;

/** A single expanded block stops being readable well before this. */
const MAX_EXPANDED_OUTPUT_LINES = 60;

export interface ToolItemDisplayProps {
  toolState: ToolCallState;
  isFirst?: boolean;
}

interface ToolStatusStyle {
  glyph: string;
  color: string;
  borderColor: string;
}

/**
 * The glyph and frame colour that report a tool call's state. The border
 * carries the state the way the reference cards do: a running call lights up
 * in the accent colour, a finished one fades to the dim spine colour, and
 * only failures and cancellations keep a loud hue.
 */
function statusStyle(
  status: ToolCallState["status"],
  activeTheme: Theme,
): ToolStatusStyle {
  switch (status) {
    case "done":
      return {
        glyph: "✓",
        color: activeTheme.status.success,
        borderColor: activeTheme.text.subtle,
      };
    case "errored":
      return {
        glyph: "x",
        color: activeTheme.status.error,
        borderColor: activeTheme.status.error,
      };
    case "canceled":
      return {
        glyph: "-",
        color: activeTheme.status.warning,
        borderColor: activeTheme.status.warning,
      };
    case "calling":
      return {
        glyph: "⊷",
        color: activeTheme.status.running,
        borderColor: activeTheme.accent,
      };
    case "generated":
    case "generating":
    default:
      return {
        glyph: "o",
        color: activeTheme.status.success,
        borderColor: activeTheme.accent,
      };
  }
}

function isTerminalStatus(status: ToolCallState["status"]): boolean {
  return status === "done" || status === "errored" || status === "canceled";
}

/** Arguments that describe a call best, most specific first. */
const DESCRIPTION_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "url",
  "query",
  "prompt",
  "text",
  "name",
];

/** One short, single-line description of a tool call's subject. */
function describeCall(toolName: string, args: any): string {
  if (!args || typeof args !== "object") {
    return "";
  }

  let value: unknown;
  for (const key of DESCRIPTION_KEYS) {
    if (key in args) {
      value = (args as Record<string, unknown>)[key];
      break;
    }
  }
  if (value === undefined) {
    const first = Object.values(args)[0];
    value = first;
  }
  if (value === undefined || value === null) {
    return "";
  }

  const text = typeof value === "string" ? value : String(value);
  const firstLine = text.split("\n")[0].trim();
  const formatted = formatToolArgument(firstLine);
  return formatted.length > 100 ? `${formatted.slice(0, 100)}...` : formatted;
}

/**
 * The amount of work a finished call produced, in the few words the reference
 * CLI puts after the arrow. A tool that has nothing worth saying gets no
 * summary rather than a generic "done".
 */
function summarizeResult(
  toolName: string,
  status: ToolCallState["status"],
  output: string,
): string | undefined {
  if (status !== "done" || !output) {
    return undefined;
  }

  const name = toolName.toLowerCase();
  const lines = output.length === 0 ? 0 : output.split("\n").length;

  if (name === "read" || name === "read_file" || name === "readfile") {
    return `${lines} ${lines === 1 ? "line" : "lines"}`;
  }
  if (name === "glob" || name === "list" || name === "listfiles") {
    const entries = output.split("\n").filter((line) => line.trim()).length;
    return `${entries} ${entries === 1 ? "entry" : "entries"}`;
  }
  if (
    name === "search" ||
    name === "grep" ||
    name === "searchcode" ||
    name === "ripgrep"
  ) {
    const matches = output.split("\n").filter((line) => line.trim()).length;
    return `${matches} ${matches === 1 ? "match" : "matches"}`;
  }
  if (
    name === "edit" ||
    name === "write" ||
    name === "multiedit" ||
    name === "applypatch" ||
    name === "patch"
  ) {
    if (isDiffContent(output)) {
      const summary = getDiffSummary(parseDiffLines(output));
      if (summary.additions > 0 || summary.deletions > 0) {
        return `+${summary.additions} -${summary.deletions}`;
      }
    }
    return "updated";
  }

  return undefined;
}

/** `0.1s` below a minute, then `1m 30s`, then `1h 2m 3s`. */
function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainder}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

interface OutputPreview {
  lines: string[];
  hiddenAbove: number;
  hiddenBelow: number;
}

function planOutput(output: string, expanded: boolean): OutputPreview {
  const lines = output.replace(/\s+$/, "").split("\n");
  if (expanded) {
    if (lines.length <= MAX_EXPANDED_OUTPUT_LINES) {
      return { lines, hiddenAbove: 0, hiddenBelow: 0 };
    }
    return {
      lines: lines.slice(0, MAX_EXPANDED_OUTPUT_LINES),
      hiddenAbove: 0,
      hiddenBelow: lines.length - MAX_EXPANDED_OUTPUT_LINES,
    };
  }

  if (lines.length <= COLLAPSED_OUTPUT_LINES) {
    return { lines, hiddenAbove: 0, hiddenBelow: 0 };
  }

  return {
    lines: lines.slice(-COLLAPSED_OUTPUT_LINES),
    hiddenAbove: lines.length - COLLAPSED_OUTPUT_LINES,
    hiddenBelow: 0,
  };
}

/** Source for the border fill: long enough for any terminal, clipped by flex. */
const BORDER_FILL = "─".repeat(500);

/**
 * One tool call: a rounded frame whose border colour carries the state (a
 * running call lights up in the accent colour, a finished one fades to the
 * dim spine colour, failures stay loud). The title lives inside the top
 * border bar the way the reference cards draw it; the output or diff preview
 * sits in the body and collapses by itself when the call finishes.
 */
export const ToolItemDisplay = memo<ToolItemDisplayProps>(({ toolState }) => {
  const activeTheme = useTheme();
  const toolName = toolState.toolCall.function.name;
  const args = toolState.parsedArgs;
  const { glyph, color, borderColor } = statusStyle(
    toolState.status,
    activeTheme,
  );
  const displayName = getToolDisplayName(toolName);
  const description = describeCall(toolName, args);
  const rawOutput = toolState.output?.length
    ? toolState.output.map((item) => item.content).join("\n")
    : "";
  // A failed call with no captured output still has to say what happened.
  const output =
    rawOutput ||
    (toolState.status === "errored" ? t("tool.executionFailed") : "");
  const summary = summarizeResult(toolName, toolState.status, output);
  const shell = isShellTool(displayName);

  const terminal = isTerminalStatus(toolState.status);
  const panelRef = useRef<DOMElement>(null);
  const [expanded, setExpanded] = useState(!terminal);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const wasTerminal = useRef(terminal);
  const startedAt = useRef<number | null>(null);
  const endedAt = useRef<number | null>(null);

  // A finished call folds its output without a second click. A call opened
  // later in a resumed session starts folded, since no clock was observed.
  useEffect(() => {
    if (terminal && !wasTerminal.current) {
      setExpanded(false);
    }
    wasTerminal.current = terminal;
  }, [terminal]);

  useEffect(() => {
    if (!terminal && startedAt.current === null) {
      startedAt.current = Date.now();
    }
    if (
      terminal &&
      startedAt.current !== null &&
      endedAt.current === null &&
      durationMs === null
    ) {
      endedAt.current = Date.now();
      setDurationMs(endedAt.current - startedAt.current);
    }
  }, [terminal, durationMs]);

  useClickRegion(panelRef, () => {
    setExpanded((current) => !current);
  });

  // Folding, unfolding and adding the duration row change this panel's height
  // without rendering the ScrollView that clips it. Tell the viewport so the
  // new height is measured and the live tail stays pinned to the bottom.
  useLayoutEffect(() => {
    markLayoutDirty();
  }, [expanded, durationMs]);

  const hasDiff = isDiffContent(output);
  const { notes, diff } = hasDiff
    ? separateDiffAndNotes(output)
    : { notes: "", diff: "" };

  const preview = planOutput(output, expanded);
  const duration = durationMs === null ? undefined : formatDuration(durationMs);
  const toggleHint =
    preview.hiddenAbove > 0
      ? `... (${preview.hiddenAbove} earlier ${
          preview.hiddenAbove === 1 ? "line" : "lines"
        }, click to expand)`
      : expanded && output
        ? "click to collapse"
        : "";

  const titleRow = (
    <Text wrap="truncate-end">
      <Text color={color} bold>
        {glyph}{" "}
      </Text>
      {shell && description ? (
        <>
          <Text color={activeTheme.text.secondary}>$ </Text>
          <Text color={activeTheme.text.primary}>{description}</Text>
        </>
      ) : (
        <>
          <Text bold color={activeTheme.accent}>
            {displayName}
          </Text>
          {description ? (
            <Text color={activeTheme.text.secondary}>: {description}</Text>
          ) : null}
        </>
      )}
      {summary ? (
        <Text color={activeTheme.text.subtle}> · {summary}</Text>
      ) : null}
    </Text>
  );

  return (
    <Box ref={panelRef} flexDirection="column" width="100%" marginTop={1}>
      <Box flexDirection="row" width="100%" flexShrink={0}>
        <Text color={borderColor}>╭─ </Text>
        <Box flexShrink={1} minWidth={0}>
          {titleRow}
        </Box>
        <Text color={borderColor}> </Text>
        <Box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0}>
          <Text color={borderColor} wrap="truncate-end">
            {BORDER_FILL}
          </Text>
        </Box>
        <Text color={borderColor}>╮</Text>
      </Box>

      <Box
        flexDirection="column"
        width="100%"
        borderStyle="round"
        borderTop={false}
        borderColor={borderColor}
        paddingX={1}
      >
        {hasDiff ? (
          <Box flexDirection="column">
            {notes ? (
              <Box marginBottom={1}>
                <Text color={activeTheme.text.secondary}>{notes}</Text>
              </Box>
            ) : null}
            <ToolDiffView
              diffContent={diff}
              expanded={expanded}
              customTheme={activeTheme}
            />
          </Box>
        ) : output ? (
          <Box flexDirection="column">
            {preview.hiddenAbove > 0 ? (
              <Text color={activeTheme.tool.hint}>{toggleHint}</Text>
            ) : null}
            <Text color={activeTheme.tool.output}>
              {preview.lines.join("\n")}
            </Text>
            {preview.hiddenBelow > 0 ? (
              <Text color={activeTheme.tool.hint}>
                ... ({preview.hiddenBelow} more lines)
              </Text>
            ) : null}
            {preview.hiddenAbove === 0 && expanded ? (
              <Text color={activeTheme.tool.hint}>{toggleHint}</Text>
            ) : null}
          </Box>
        ) : null}

        {duration ? (
          <Text color={activeTheme.tool.hint}>({duration})</Text>
        ) : null}
      </Box>
    </Box>
  );
});

ToolItemDisplay.displayName = "ToolItemDisplay";

export interface ToolGroupDisplayProps {
  toolStates: ToolCallState[];
}

/**
 * The tool calls of one assistant step, each as its own panel. The blank row
 * before a panel is the margin the panel carries, so consecutive calls read as
 * separate executions rather than one dense list.
 */
export const ToolGroupDisplay = memo<ToolGroupDisplayProps>(
  ({ toolStates }) => {
    if (!toolStates || toolStates.length === 0) {
      return null;
    }

    return (
      <Box flexDirection="column">
        {toolStates.map((state) => (
          <ToolItemDisplay
            key={state.toolCallId || state.toolCall.function.name}
            toolState={state}
          />
        ))}
      </Box>
    );
  },
);

ToolGroupDisplay.displayName = "ToolGroupDisplay";
