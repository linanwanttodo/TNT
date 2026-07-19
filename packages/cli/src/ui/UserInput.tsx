/* eslint-disable max-lines, complexity */
/* eslint-disable max-statements -- the composer's key state machine is one flat dispatch; every branch is a key or mode it must own, and splitting it further hides the order the keys are claimed in. */

import os from "node:os";

import { type AssistantConfig } from "@tnt/sdk";
import { Box, Text, useApp } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { t } from "../i18n/index.js";
import type { PermissionMode } from "../permissions/types.js";
import type { FileIndexServiceState } from "../services/FileIndexService.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";
import type { ToolPermissionServiceState } from "../services/ToolPermissionService.js";
import {
  clearPromptSuggestion,
  markPromptSuggestionShown,
  usePromptSuggestion,
} from "../session/promptSuggestion.js";
import { messageQueue } from "../stream/messageQueue.js";
import { escapeEvents } from "../utils/cli.js";
import { getClipboardImage } from "../utils/clipboard.js";
import { InputHistory } from "../utils/inputHistory.js";
import { logger } from "../utils/logger.js";

import { getAllSlashCommands, type SlashCommand } from "./commands/index.js";
import {
  formatWorkspaceLocation,
  getThinkingDepth,
} from "./components/BottomStatusBar.js";
import { GoalIndicator } from "./components/GoalIndicator.js";
import { HalfLinePaddedBox } from "./components/HalfLinePaddedBox.js";
import { modeBadge } from "./components/ModeIndicator.js";
import { SuggestionOverlay } from "./components/SuggestionOverlay.js";
import {
  expandPastePlaceholders,
  useTextBuffer,
} from "./components/text-buffer.js";
import { TextInput } from "./components/TextInput.js";
import { TodoIndicator } from "./components/TodoIndicator.js";
import { consumeComposerDraft, useComposerDraft } from "./composerDraft.js";
import { FileSearchUI } from "./FileSearchUI.js";
import { useHistorySearch } from "./hooks/useHistorySearch.js";
import { useKeypress, type Key } from "./hooks/useKeypress.js";
import { useLocale } from "./hooks/useLocale.js";
import { useServices } from "./hooks/useService.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { handleControlKeys } from "./hooks/useUserInput.js";
import { filterSlashLevel, parseSlashInput } from "./slashCommandParser.js";
import { SlashCommandUI } from "./SlashCommandUI.js";
import {
  agentSourcesFromModelState,
  agentSuggestionItems,
  commandSuggestionItems,
  fileSuggestionFromPath,
  fileSuggestionItems,
  filterSuggestionItems,
  mcpResourcesFromState,
  mcpSuggestionItems,
  mergeSuggestionGroups,
  type AgentSuggestionSource,
  type McpResourceSuggestionSource,
  type SuggestionItem,
} from "./suggestionSources.js";
import { useTheme } from "./theme/tokens.js";
import { UpdateNotification } from "./UpdateNotification.js";

// Small presentational helper to reduce cyclomatic complexity in UserInput
const SlashCommandsMaybe: React.FC<{
  show: boolean;
  inputMode: boolean;
  hideNormalUI: boolean;
  isRemoteMode: boolean;
  assistant?: AssistantConfig;
  commands: SlashCommand[];
  levelLabel?: string | null;
  filter: string;
  selectedIndex: number;
}> = ({
  show,
  inputMode,
  hideNormalUI,
  isRemoteMode: _isRemoteMode,
  assistant,
  commands,
  levelLabel,
  filter,
  selectedIndex,
}) => {
  if (!show || !inputMode || hideNormalUI || !assistant) return null;
  return (
    <SlashCommandUI
      assistant={assistant}
      commands={commands}
      levelLabel={levelLabel}
      filter={filter}
      selectedIndex={selectedIndex}
    />
  );
};

const FileSearchMaybe: React.FC<{
  show: boolean;
  inputMode: boolean;
  hideNormalUI: boolean;
  isRemoteMode: boolean;
  filter: string;
  selectedIndex: number;
  onSelect: (path: string) => void | Promise<void>;
  onFilesUpdated: (files: Array<{ path: string; displayName: string }>) => void;
}> = ({
  show,
  inputMode,
  hideNormalUI,
  isRemoteMode,
  filter,
  selectedIndex,
  onSelect,
  onFilesUpdated,
}) => {
  if (!show || !inputMode || hideNormalUI || isRemoteMode) return null;
  return (
    <FileSearchUI
      filter={filter}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onFilesUpdated={onFilesUpdated}
    />
  );
};

interface ComposerSuggestionSources {
  available: boolean;
  agents: AgentSuggestionSource[];
  mcp: McpResourceSuggestionSource[];
}

/** Agents and MCP resources are read once per render from the live services. */
function composerSuggestionSources(
  assistant?: AssistantConfig,
): ComposerSuggestionSources {
  if (!assistant) {
    return { available: false, agents: [], mcp: [] };
  }
  return {
    available: true,
    agents: agentSourcesFromModelState(services.model.getState()),
    mcp: mcpResourcesFromState(services.mcp.getState()),
  };
}

/** Case-insensitive over name and description, prefixes first. */
function filterCommandList(
  commands: readonly SlashCommand[],
  filter: string,
): SlashCommand[] {
  const needle = filter.toLowerCase();
  return commands
    .filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(needle) ||
        cmd.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(needle);
      const bStartsWith = b.name.toLowerCase().startsWith(needle);

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      return a.name.localeCompare(b.name);
    });
}

interface AtSuggestionInput {
  unified: boolean;
  files: readonly { path: string }[];
  fallbackFiles: readonly { path: string }[];
  query: string;
  agents: readonly AgentSuggestionSource[];
  mcp: readonly McpResourceSuggestionSource[];
}

/** The `@` list: files first, then agents, then MCP resources. */
function buildAtSuggestions(input: AtSuggestionInput): SuggestionItem[] {
  if (!input.unified) {
    return input.fallbackFiles.map((file) => fileSuggestionFromPath(file.path));
  }
  return mergeSuggestionGroups(
    fileSuggestionItems(input.files, input.query),
    filterSuggestionItems(agentSuggestionItems(input.agents), input.query),
    filterSuggestionItems(mcpSuggestionItems(input.mcp), input.query),
  );
}

/** Read an accepted file and hand it to the transcript as an attachment. */
async function attachFileContent(
  onFileAttached: ((filePath: string, content: string) => void) | undefined,
  filePath: string,
): Promise<void> {
  if (!onFileAttached) {
    return;
  }
  // The default keeps an @ attachment inside the workspace; that is the
  // security baseline. Reading an arbitrary local path is the user's explicit
  // decision, made by setting TNT_ALLOW_ANY_ATTACHMENT_PATH=1.
  const allowAny = process.env.TNT_ALLOW_ANY_ATTACHMENT_PATH === "1";
  const path = await import("path");
  let absolutePath: string;
  if (allowAny) {
    absolutePath = path.resolve(filePath);
  } else {
    try {
      const { resolveWithin } = await import("../utils/pathGuard.js");
      absolutePath = resolveWithin(process.cwd(), filePath);
    } catch (error) {
      console.error(
        `@${filePath} is outside the workspace; reading it requires TNT_ALLOW_ANY_ATTACHMENT_PATH=1`,
        error,
      );
      return;
    }
  }
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(absolutePath, "utf-8");
    onFileAttached(absolutePath, content);
  } catch (error) {
    // If file doesn't exist, just attach the filename without content
    if (error instanceof Error && (error as any).code === "ENOENT") {
      onFileAttached(absolutePath, filePath);
    } else {
      console.error(t("chat.fileReadFailed", { path: filePath }), error);
    }
  }
}

/**
 * The "@" that opens the file-search context before the cursor, or -1: it must
 * start a word and carry no space between it and the cursor.
 */
function activeFileSearchAtIndex(beforeCursor: string): number {
  for (let i = beforeCursor.length - 1; i >= 0; i--) {
    if (beforeCursor[i] !== "@") continue;
    const beforeAt = beforeCursor.slice(0, i);
    const lastChar = beforeAt[beforeAt.length - 1];
    if (i !== 0 && lastChar !== " " && lastChar !== "\n") continue;
    const afterThis = beforeCursor.slice(i + 1);
    if (!afterThis.includes(" ") && !afterThis.includes("\n")) {
      return i;
    }
  }
  return -1;
}

/**
 * The suggestion the empty composer should show, or null when something is
 * running, something is typed, or there is nothing suggested.
 */
function visibleSuggestionText(input: {
  suggestion: { text: string } | null;
  inputText: string;
  isWaitingForResponse: boolean;
  isCompacting: boolean;
}): string | null {
  return input.suggestion &&
    input.inputText.length === 0 &&
    !input.isWaitingForResponse &&
    !input.isCompacting
    ? input.suggestion.text
    : null;
}

export type PromptMarkerTone = "subtle" | "bash" | "remote";

export interface PromptMarker {
  glyph: string;
  tone: PromptMarkerTone;
  /** A running turn fades the pointer while the answer arrives. */
  dim: boolean;
}

/**
 * The mark before the input. The normal prompt is Claude Code's pointer in the
 * subtle colour; shell mode keeps its `$` and remote mode its own mark so the
 * mode stays readable at a glance.
 */
export function promptMarker(input: {
  bash: boolean;
  remote: boolean;
  busy: boolean;
}): PromptMarker {
  if (input.bash) {
    return { glyph: "$ ", tone: "bash", dim: input.busy };
  }
  if (input.remote) {
    return { glyph: "◉ ", tone: "remote", dim: input.busy };
  }
  return { glyph: "> ", tone: "subtle", dim: input.busy };
}

const ComposerPrompt: React.FC<{
  bash: boolean;
  remote: boolean;
  busy: boolean;
  subtle: string;
  warning: string;
}> = ({ bash, remote, busy, subtle, warning }) => {
  const marker = promptMarker({ bash, remote, busy });
  return (
    <Text
      color={
        marker.tone === "bash"
          ? warning
          : marker.tone === "remote"
            ? "cyan"
            : subtle
      }
      dimColor={marker.dim}
      bold={marker.tone !== "subtle"}
    >
      {marker.glyph}
    </Text>
  );
};

interface UserInputProps {
  onSubmit: (message: string, imageMap?: Map<string, Buffer>) => void;
  isWaitingForResponse: boolean;
  isCompacting?: boolean;
  inputMode: boolean;
  onInterrupt?: () => void;
  assistant?: AssistantConfig;
  wasInterrupted?: boolean;
  onFileAttached?: (filePath: string, content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hideNormalUI?: boolean;
  isRemoteMode?: boolean;
  onShowEditSelector?: () => void;
  onOpenPalette?: () => void;
}

/**
 * Shift+Tab cycles every interactive mode, bypassPermissions included.
 * Returns the mode it switched to.
 */
function cycleModes(): PermissionMode {
  const modes: PermissionMode[] = [
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "bypassPermissions",
  ];
  const currentMode = services.toolPermissions.getCurrentMode();
  const currentIndex = modes.indexOf(currentMode);
  const nextMode = modes[(currentIndex + 1) % modes.length];

  services.toolPermissions.switchMode(nextMode);
  serviceContainer.set(
    SERVICE_NAMES.TOOL_PERMISSIONS,
    services.toolPermissions.getState(),
  );
  return nextMode;
}

/** One row under the input box: mode and directory left, model right. */
const ComposerFooter: React.FC<{
  mode: PermissionMode;
  isRemoteMode: boolean;
  remoteUrl?: string;
}> = ({ mode, isRemoteMode, remoteUrl }) => {
  const theme = useTheme();
  const badge = modeBadge(mode, theme);
  const directory =
    remoteUrl ?? formatWorkspaceLocation(process.cwd(), os.homedir());
  const model = services?.model?.getState?.().model as
    | { name?: string; model?: string; defaultCompletionOptions?: unknown }
    | null
    | undefined;
  const modelName = model?.name || model?.model || "";
  const thinkingDepth = getThinkingDepth(model as any);

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexDirection="row">
        <Text color={badge.color} bold>
          {badge.label}
        </Text>
        {!isRemoteMode && directory ? (
          <Text color={theme.text.subtle}> {directory}</Text>
        ) : null}
      </Box>
      <Box flexDirection="row">
        {modelName ? <Text color={theme.text.primary}>{modelName}</Text> : null}
        {modelName && thinkingDepth ? (
          <Text color={theme.border.focus}>
            {" "}
            {t("status.think")}:{thinkingDepth}
          </Text>
        ) : null}
        <Box marginLeft={1}>
          <UpdateNotification isRemoteMode={isRemoteMode} />
        </Box>
      </Box>
    </Box>
  );
};

const MAX_INPUT_VIEWPORT_HEIGHT = 8;

const UserInput: React.FC<UserInputProps> = ({
  onSubmit,
  isWaitingForResponse,
  isCompacting = false,
  inputMode,
  onInterrupt,
  assistant,
  wasInterrupted = false,
  onFileAttached,
  disabled = false,
  placeholder,
  hideNormalUI = false,
  isRemoteMode = false,
  onShowEditSelector,
  onOpenPalette,
}) => {
  const locale = useLocale();
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const [inputHistory] = useState(() => new InputHistory());
  const lastEscapePressRef = useRef<number>(0);
  const imageCounterRef = useRef(0);
  const imageMapRef = useRef<Map<string, Buffer>>(new Map());

  // The gemini text buffer owns the text, the visual wrapping and the caret.
  // Derived composer state (palette, file search, shell mode) follows the
  // committed buffer text: the onChange hook fires after React commits, so it
  // always reads the state the keys produced, even for bursts inside one
  // stdin read.
  const syncDerivedStateRef = useRef<() => void>(() => {});
  const onBufferChange = useCallback(() => {
    syncDerivedStateRef.current();
  }, []);

  const buffer = useTextBuffer({
    initialText: "",
    viewport: {
      width: Math.max(20, columns - 4),
      height: MAX_INPUT_VIEWPORT_HEIGHT,
    },
    singleLine: false,
    onChange: onBufferChange,
  });

  // Reads go through a ref: dispatches inside one stdin batch flush before
  // the next key is handled, and the ref then exposes the committed buffer
  // without waiting for this component's render.
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;

  const [inputText, setInputText] = useState("");
  // The post-turn suggestion shown faint in the empty composer; Tab accepts it.
  const promptSuggestion = usePromptSuggestion();
  const [showSlashCommands, setShowSlashCommands] = useState(false);

  const [slashCommandFilter, setSlashCommandFilter] = useState("");
  /** Parent command when the palette has descended into its subcommands. */
  const [slashParent, setSlashParent] = useState<string | null>(null);
  const [slashLevel, setSlashLevel] = useState<SlashCommand[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [showBashMode, setShowBashMode] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchFilter, setFileSearchFilter] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [currentFiles, setCurrentFiles] = useState<
    Array<{ path: string; displayName: string }>
  >([]);
  const { exit } = useApp();

  // Get file index service state for reactive updates (unused but needed for service initialization)
  const fileIndexState = useServices<{
    fileIndex: FileIndexServiceState;
  }>(["fileIndex"]).services.fileIndex;
  const { services: permissionServices } = useServices<{
    toolPermissions: ToolPermissionServiceState;
  }>([SERVICE_NAMES.TOOL_PERMISSIONS]);
  const currentMode = permissionServices.toolPermissions?.currentMode ?? "auto";

  // The unified list needs the loaded assistant context. Without it the two
  // established pickers stay in charge, so an early screen or a failed load
  // still offers commands and files.
  const {
    available: unifiedSuggestionsAvailable,
    agents: agentSources,
    mcp: mcpResources,
  } = composerSuggestionSources(assistant);

  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([
    { name: "help", description: t("cmd.help"), category: "system" },
    {
      name: "clear",
      description: t("cmd.clear"),
      category: "system",
    },
    { name: "exit", description: t("cmd.exit"), category: "system" },
  ]);

  useEffect(() => {
    const loadCommands = async () => {
      if (assistant) {
        const commands = await getAllSlashCommands(assistant);
        setSlashCommands(commands);
      }
    };

    void loadCommands();
  }, [assistant?.prompts, assistant?.rules, locale]);

  // The command list arrives asynchronously; re-derive the palette level for
  // whatever is already in the box once it lands.
  useEffect(() => {
    syncDerivedStateRef.current();
  }, [slashCommands]);

  const syncDerivedState = () => {
    const live = bufferRef.current;
    const text = live.text;
    const cursor = live.getOffset();
    setInputText(text);
    updateSlashCommandState(text, cursor);
    updateFileSearchState(text, cursor);
    updateBashModeState(text);
    inputHistory.resetNavigation();
  };
  // Stable access for callbacks registered outside the render loop: the
  // derived-state machines read the palette state of the frame on screen.
  syncDerivedStateRef.current = syncDerivedState;

  // Update shell mode state based on input
  const updateBashModeState = (text: string) => {
    const trimmed = text.trimStart();
    const isBash = trimmed.startsWith("!");
    setShowBashMode(isBash);
    if (isBash) {
      // Disable other helpers while in shell mode
      setShowSlashCommands(false);
      setShowFileSearch(false);
    }
  };

  // Update slash command UI state based on input, walking the command tree
  // the way gemini-cli's completion hook does. Any depth of subcommands works,
  // and a leaf with free-form arguments closes the palette.
  const updateSlashCommandState = (text: string, cursor: number) => {
    const parsed = parseSlashInput(text, cursor, slashCommands);
    setShowSlashCommands(parsed.active);
    setSlashParent(parsed.path.length > 0 ? parsed.path.join(" ") : null);
    setSlashLevel(parsed.level);
    setSlashCommandFilter(parsed.filter);
    setSelectedCommandIndex(0);
    if (parsed.active) {
      setShowFileSearch(false);
    }
  };

  // Update file search UI state based on input
  const updateFileSearchState = (text: string, cursor: number) => {
    // Remote mode, shell mode and slash command mode all suppress file search
    const trimmed = text.trimStart();
    const suppressed =
      isRemoteMode || trimmed.startsWith("!") || trimmed.startsWith("/");
    const firstAtIndex = suppressed
      ? -1
      : activeFileSearchAtIndex(text.slice(0, cursor));

    if (firstAtIndex === -1) {
      setShowFileSearch(false);
      return;
    }

    setShowFileSearch(true);
    setFileSearchFilter(text.slice(firstAtIndex + 1, cursor));
    setSelectedFileIndex(0);
    setShowSlashCommands(false);
    setShowBashMode(false);
  };

  // The list a level offers: the root commands, or a parent's children.
  const levelCommands = (): SlashCommand[] =>
    slashLevel.length > 0 ? slashLevel : slashCommands;

  // Handle slash command selection
  const selectSlashCommand = (commandName: string) => {
    const beforeCursor = inputText.slice(0, bufferRef.current.getOffset());
    const lastSlashIndex = beforeCursor.lastIndexOf("/");

    if (lastSlashIndex !== -1) {
      const beforeSlash = bufferRef.current.text.slice(0, lastSlashIndex);
      const afterCursor = bufferRef.current.text.slice(
        bufferRef.current.getOffset(),
      );

      // Replace the partial command with the full command
      const newText = beforeSlash + "/" + commandName + " " + afterCursor;
      const newCursorPos = lastSlashIndex + 1 + commandName.length + 1;

      buffer.setText(newText, newCursorPos);
      setShowBashMode(false);
      syncDerivedState();
    }
  };

  /**
   * Accept one row of the `@` list: replace the token before the cursor with
   * `@value`, keep one separating space after it, and attach a file when the
   * row names one. A directory completes without a space so the reader can
   * keep typing the rest of the path.
   */
  const acceptAtSuggestion = async (item: SuggestionItem) => {
    const cursorOffset = bufferRef.current.getOffset();
    const firstAtIndex = activeFileSearchAtIndex(
      bufferRef.current.text.slice(0, cursorOffset),
    );
    if (firstAtIndex === -1) {
      return;
    }

    const beforeAt = bufferRef.current.text.slice(0, firstAtIndex);
    const afterCursor = bufferRef.current.text.slice(cursorOffset);
    const atEnd = afterCursor === "";
    const separator =
      item.isDirectory || (!atEnd && /^\s/.test(afterCursor)) ? "" : " ";
    const newText = beforeAt + "@" + item.insertText + separator + afterCursor;
    const newCursorPos =
      firstAtIndex + 1 + item.insertText.length + separator.length;

    buffer.setText(newText, newCursorPos);
    setShowFileSearch(false);

    if (item.filePath) {
      await attachFileContent(onFileAttached, item.filePath);
    }
  };

  const handleSlashCommandNavigation = (key: Key): boolean => {
    const filteredCommands = filterSlashLevel(
      levelCommands(),
      slashCommandFilter,
    );

    if (key.name === "up") {
      setSelectedCommandIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCommands.length - 1,
      );
      return true;
    }

    if (key.name === "down") {
      setSelectedCommandIndex((prev) =>
        prev < filteredCommands.length - 1 ? prev + 1 : 0,
      );
      return true;
    }

    if ((key.name === "enter" && !key.shift) || key.name === "tab") {
      // A bare "/" has an empty filter: Enter belongs to the prompt line, not
      // the first palette entry. Treat it as no selection so dispatch falls
      // through and nothing executes.
      if (slashCommandFilter === "") {
        return false;
      }
      if (filteredCommands.length > 0) {
        const selected = filteredCommands[selectedCommandIndex];
        const commandName = selected.name;
        const fullCommand = slashParent
          ? `${slashParent} ${commandName}`
          : commandName;
        const hasParent = !!slashParent;
        // A parent with children is completed (opening them), never submitted
        // alone; a leaf runs only once a prefix was deliberately typed.
        const hasChildren = (selected.subcommands?.length ?? 0) > 0;
        const canRun =
          key.name === "enter" &&
          slashCommandFilter !== "" &&
          commandName !== "title" &&
          !hasChildren;

        if (hasParent && canRun) {
          // A child of the open level: run "/parent child".
          const commandText = `/${fullCommand}`;
          inputHistory.addEntry(commandText);
          if (!isRemoteMode && (isWaitingForResponse || isCompacting)) {
            void messageQueue.enqueueMessage(commandText);
          } else {
            onSubmit(commandText);
          }
          buffer.setText("");
          setShowSlashCommands(false);
          setSlashParent(null);
          setShowBashMode(false);
        } else if (!hasParent && canRun) {
          // select and submit the command
          const commandText = "/" + commandName;
          inputHistory.addEntry(commandText);

          // queue up when responding/generating
          if (!isRemoteMode && (isWaitingForResponse || isCompacting)) {
            void messageQueue.enqueueMessage(commandText);
          } else {
            onSubmit(commandText);
          }

          buffer.setText("");
          setShowSlashCommands(false);
          setShowBashMode(false);
        } else {
          // Completing, not running: a parent opens its children, a child
          // lands its full path in the input.
          selectSlashCommand(fullCommand);
        }
      }
      return true;
    }

    return false;
  };

  const handleFileSearchNavigation = (key: Key): boolean => {
    const items = buildAtSuggestions({
      unified: unifiedSuggestionsAvailable,
      files: fileIndexState?.files ?? [],
      fallbackFiles: currentFiles,
      query: fileSearchFilter,
      agents: agentSources,
      mcp: mcpResources,
    });

    if (key.ctrl && key.name === "r") {
      void services.fileIndex.refreshIndex(true);
      return true;
    }

    if (key.name === "up") {
      setSelectedFileIndex((prev) =>
        prev > 0 ? prev - 1 : Math.max(0, items.length - 1),
      );
      return true;
    }

    if (key.name === "down") {
      setSelectedFileIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      return true;
    }

    if ((key.name === "enter" && !key.shift) || key.name === "tab") {
      const item = items[selectedFileIndex];
      if (item) {
        void acceptAtSuggestion(item);
      }
      return true;
    }

    return false;
  };

  // Ctrl+F history search; the hint line reads its state, the key handlers
  // live in the hook.
  const historySearch = useHistorySearch({
    buffer,
    inputHistory,
    inputText,
    setInputText,
    setShowSlashCommands,
    setShowFileSearch,
    refreshDerivedState: syncDerivedState,
    inputMode,
    showSlashCommands,
    showFileSearch,
  });

  // Clear input function for Ctrl+C
  const clearInput = useCallback(() => {
    buffer.setText("");
    imageMapRef.current.clear();
    setShowSlashCommands(false);
    setShowFileSearch(false);
    setShowBashMode(false);
    inputHistory.resetNavigation();
    historySearch.reset();
  }, [buffer, historySearch]);

  /**
   * Every key the composer answers before the buffer sees the input: the
   * history search, the open palette, mode cycling, escape, and the post-turn
   * suggestion. Returns false to hand the key to the buffer.
   */
  const dispatchComposerKeys = (key: Key): boolean => {
    if (historySearch.search.active) {
      historySearch.handleKeys(key);
      return true;
    }
    if (historySearch.maybeOpen(key)) {
      return true;
    }
    if (key.name === "tab" && key.shift) {
      cycleModes();
      return true;
    }
    if (handleEscapeKey(key)) {
      return true;
    }
    if (showSlashCommands && handleSlashCommandNavigation(key)) {
      return true;
    }
    if (showFileSearch && handleFileSearchNavigation(key)) {
      return true;
    }
    if (!showSlashCommands && !showFileSearch) {
      const navigate = (entry: string | null) => {
        if (entry === null) return;
        buffer.setText(entry, "end");
        setInputText(entry);
      };
      // History navigation only claims the arrows when the caret cannot move
      // any further in its own line: a multi-line buffer moves the caret first.
      const [cursorRow] = bufferRef.current.cursor;
      const canMoveUp = cursorRow > 0 || bufferRef.current.lines.length > 1;
      const canMoveDown =
        cursorRow < bufferRef.current.lines.length - 1 ||
        bufferRef.current.lines.length > 1;
      if (key.name === "up" && !canMoveUp) {
        navigate(inputHistory.navigateUp(inputText));
        return true;
      }
      if (key.name === "down" && !canMoveDown) {
        navigate(inputHistory.navigateDown());
        return true;
      }
    }
    if (showSlashCommands || showFileSearch) {
      return false;
    }
    if (
      key.name === "tab" &&
      !key.shift &&
      promptSuggestion &&
      inputText.length === 0
    ) {
      const text = promptSuggestion.text;
      clearPromptSuggestion();
      buffer.setText(text, "end");
      setInputText(text);
      return true;
    }
    if (key.name !== "tab" && key.insertable && promptSuggestion) {
      clearPromptSuggestion();
    }
    return false;
  };

  /** The images whose placeholder is still in the submitted text. */
  const collectImages = (text: string): Map<string, Buffer> => {
    const map = new Map<string, Buffer>();
    for (const [id, data] of imageMapRef.current) {
      if (text.includes(id)) {
        map.set(id, data);
      }
    }
    return map;
  };

  /** Enter submits; Shift+Enter (and the parser's backslash-Enter) newline. */
  const handleEnterKey = (): void => {
    const live = bufferRef.current;
    // A lone "/" belongs to no command: keep it in the box.
    if (live.text.trim() === "/") {
      return;
    }

    const rawText = live.text;
    const expandedText = expandPastePlaceholders(rawText, live.pastedContent);
    const submittedText = expandedText.trim();
    const imageMap = collectImages(expandedText);

    if (submittedText || wasInterrupted) {
      inputHistory.addEntry(submittedText);

      // We don't queue, we just send in remote mode because the server handles queueing
      if (
        !isRemoteMode &&
        (isWaitingForResponse || isCompacting) &&
        !submittedText.startsWith("/")
      ) {
        // Process message later when LLM has responded or compaction is complete
        void messageQueue.enqueueMessage(submittedText, imageMap);
      } else {
        // A slash command submits the moment Enter lands, as in the
        // reference CLI: UI commands run immediately; turn-scoped ones the
        // hook defers back to the queue at its own boundary.
        onSubmit(submittedText, imageMap);
      }

      buffer.setText("");
      imageMapRef.current.clear();
      setShowSlashCommands(false);
      setShowBashMode(false);
      setInputText("");
    }
  };

  const handleEscapeKey = (key: Key): boolean => {
    if (key.name !== "escape") return false;

    escapeEvents.emit("user-escape");

    // If only "!" is present, clear shell mode
    if (inputMode && showBashMode && inputText.trim() === "!") {
      buffer.setText("");
      setInputText("");
      setShowBashMode(false);
      return true;
    }

    // Handle escape key to interrupt compaction (higher priority)
    if (isCompacting && onInterrupt) {
      onInterrupt();
      return true;
    }

    // Handle escape key to interrupt streaming
    if (isWaitingForResponse && onInterrupt) {
      onInterrupt();
      return true;
    }

    // Handle escape key to close slash command UI
    if (showSlashCommands && inputMode) {
      setShowSlashCommands(false);
      setSlashParent(null);
      return true;
    }

    // Handle escape key to close file search UI
    if (showFileSearch && inputMode) {
      setShowFileSearch(false);
      return true;
    }

    // Double escape opens the edit message selector. The gemini parser emits
    // one escape event per press, so the time window is the counter.
    const now = Date.now();
    const secondPress = now - lastEscapePressRef.current < 500;
    if (
      inputMode &&
      !showSlashCommands &&
      !showFileSearch &&
      !showBashMode &&
      onShowEditSelector &&
      secondPress
    ) {
      onShowEditSelector();
      lastEscapePressRef.current = 0;
      return true;
    }

    lastEscapePressRef.current = now;
    return false;
  };

  // A queued message moved back for editing arrives as a one-shot draft.
  const pendingDraft = useComposerDraft();
  useEffect(() => {
    if (!pendingDraft) {
      return;
    }

    buffer.setText(pendingDraft.text, "end");
    syncDerivedStateRef.current();
    consumeComposerDraft(pendingDraft.id);
  }, [pendingDraft, buffer]);

  /** Ctrl+V pastes a clipboard image as a placeholder in the buffer. */
  const handleImagePaste = (): boolean => {
    logger.debug("Handling Ctrl+V clipboard paste");
    getClipboardImage()
      .then((imageBuffer) => {
        if (!imageBuffer) return;
        try {
          imageCounterRef.current += 1;
          const placeholder = `[Image #${imageCounterRef.current}]`;
          imageMapRef.current.set(placeholder, imageBuffer);
          buffer.insert(placeholder);
          syncDerivedStateRef.current();
        } catch (error) {
          logger.debug("Error adding clipboard image:", error);
        }
      })
      .catch((error) => {
        logger.debug("Error reading clipboard image:", error);
      });
    return true;
  };

  const handleKey = (key: Key): boolean => {
    // Don't handle any input when disabled.
    if (disabled) {
      return true;
    }

    if (key.ctrl && key.name === "v" && !isRemoteMode) {
      handleImagePaste();
    }

    if (
      handleControlKeys({
        key,
        exit,
        clearInput,
        queueActionsEnabled:
          !disabled &&
          !showFileSearch &&
          !showSlashCommands &&
          !historySearch.search.active,
        onOpenPalette,
      })
    ) {
      return true;
    }

    if (dispatchComposerKeys(key)) {
      return true;
    }

    if (
      key.name === "enter" &&
      !key.shift &&
      !showSlashCommands &&
      !showFileSearch
    ) {
      handleEnterKey();
      return true;
    }

    buffer.handleInput(key);
    return true;
  };

  // The dispatch is re-created per render: every branch reads the palette
  // and mode state the current frame was drawn from. The ref hands the
  // latest closure to the stable subscription.
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useKeypress((key: Key) => handleKeyRef.current(key), {
    isActive: true,
    priority: true,
  });

  // Don't render anything when disabled
  if (disabled) {
    return null;
  }

  const suggestionText = visibleSuggestionText({
    suggestion: promptSuggestion,
    inputText,
    isWaitingForResponse,
    isCompacting,
  });
  if (suggestionText) {
    markPromptSuggestionShown();
  }
  const placeholderText =
    suggestionText ??
    placeholder ??
    (isRemoteMode
      ? t("composer.placeholderRemote")
      : t("composer.placeholder"));

  return (
    <Box flexDirection="column">
      {/* One muted row above the composer while the history search is open:
          the query, the position in the match list, and the keys. */}
      {historySearch.search.active && (
        <Box marginLeft={2}>
          <Text color={theme.text.secondary} dimColor>
            {t("composer.historySearchHint", {
              query: historySearch.search.query,
              current: historySearch.search.matchIndex + 1,
              total: historySearch.search.matches.length,
            })}
          </Text>
        </Box>
      )}

      {/* One suggestion list floats above the composer: commands for a `/`
          token, and files, agents and MCP resources for `@`. The established
          pickers remain the fallback until the assistant context loads. */}
      {unifiedSuggestionsAvailable ? (
        <>
          <SuggestionOverlay
            show={
              showSlashCommands &&
              inputMode &&
              !hideNormalUI &&
              !historySearch.search.active
            }
            items={commandSuggestionItems(
              filterCommandList(levelCommands(), slashCommandFilter),
            )}
            selectedIndex={selectedCommandIndex}
            emptyText={t("commands.noMatches")}
            levelLabel={slashParent ? `/${slashParent}` : null}
          />

          <SuggestionOverlay
            show={
              showFileSearch &&
              inputMode &&
              !hideNormalUI &&
              !historySearch.search.active
            }
            items={buildAtSuggestions({
              unified: unifiedSuggestionsAvailable,
              files: fileIndexState?.files ?? [],
              fallbackFiles: currentFiles,
              query: fileSearchFilter,
              agents: agentSources,
              mcp: mcpResources,
            })}
            selectedIndex={selectedFileIndex}
            emptyText={t("files.noMatches")}
          />
        </>
      ) : (
        <>
          <SlashCommandsMaybe
            show={showSlashCommands && !historySearch.search.active}
            inputMode={inputMode}
            hideNormalUI={!!hideNormalUI}
            isRemoteMode={!!isRemoteMode}
            assistant={assistant}
            commands={levelCommands()}
            levelLabel={slashParent ? `/${slashParent}` : null}
            filter={slashCommandFilter}
            selectedIndex={selectedCommandIndex}
          />

          <FileSearchMaybe
            show={showFileSearch && !historySearch.search.active}
            inputMode={inputMode}
            hideNormalUI={!!hideNormalUI}
            isRemoteMode={!!isRemoteMode}
            filter={fileSearchFilter}
            selectedIndex={selectedFileIndex}
            onSelect={(filePath) =>
              acceptAtSuggestion(fileSuggestionFromPath(filePath))
            }
            onFilesUpdated={setCurrentFiles}
          />
        </>
      )}

      {/* Goal and todos stay above the box; the mode moves to the footer. */}
      <GoalIndicator />

      <TodoIndicator />

      {/* The gemini-style input box: a solid surface band with half-line
          padding, the prompt pointer and the buffer's visual lines. */}
      <HalfLinePaddedBox backgroundBaseColor={theme.background.composer}>
        <Box flexGrow={1} flexDirection="row" paddingX={1}>
          <ComposerPrompt
            bash={showBashMode}
            remote={isRemoteMode}
            busy={isWaitingForResponse || isCompacting}
            subtle={theme.text.primary}
            warning={theme.status.warning}
          />
          <Box flexGrow={1} flexDirection="column">
            <TextInput
              buffer={buffer}
              placeholder={placeholderText}
              focus={inputMode || isWaitingForResponse}
            />
          </Box>
        </Box>
      </HalfLinePaddedBox>

      {/* Mode and directory left, model and reasoning depth right. */}
      <ComposerFooter
        mode={currentMode}
        isRemoteMode={isRemoteMode}
        remoteUrl={undefined}
      />
    </Box>
  );
};

export { UserInput };
