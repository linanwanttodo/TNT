/* eslint-disable max-lines */
/* eslint-disable max-statements -- the composer's key state machine is one flat dispatch; every branch is a key or mode it must own, and splitting it further hides the order the keys are claimed in. */

import { type AssistantConfig } from "@tnt/sdk";
import { Box, Text, useApp, useInput } from "ink";
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
import {
  splitTrailingEnter,
  type CoalescedEnter,
} from "../utils/coalescedEnter.js";
import { InputHistory } from "../utils/inputHistory.js";

import { getAllSlashCommands, type SlashCommand } from "./commands/index.js";
import { GoalIndicator } from "./components/GoalIndicator.js";
import { ModeIndicator } from "./components/ModeIndicator.js";
import { SuggestionOverlay } from "./components/SuggestionOverlay.js";
import { TodoIndicator } from "./components/TodoIndicator.js";
import { consumeComposerDraft, useComposerDraft } from "./composerDraft.js";
import { FileSearchUI } from "./FileSearchUI.js";
import { useHistorySearch } from "./hooks/useHistorySearch.js";
import { useLocale } from "./hooks/useLocale.js";
import { useServices } from "./hooks/useService.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import {
  escapePresses,
  handleControlKeys,
  updateTextBufferState,
} from "./hooks/useUserInput.js";
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
import { claudeGlyphs } from "./symbols.js";
import { RAPID_INPUT_THRESHOLD, TextBuffer } from "./TextBuffer.js";
import { useTheme } from "./theme/tokens.js";
import { composeRule } from "./utils/borderLine.js";
import { isTerminalMouseSequence } from "./utils/mouse.js";

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

/**
 * The text-plus-Enter chunk, when this chunk is one. A chunk typed into the
 * paste fallback or the rapid-input buffer keeps its line breaks; a burst long
 * enough to be a paste is left to that path too.
 */
function coalescedEnterFor(
  input: string,
  key: any,
  textBuffer: TextBuffer,
): CoalescedEnter | null {
  if (key.shift || textBuffer.isInPasteMode()) {
    return null;
  }
  if (input.length > RAPID_INPUT_THRESHOLD + 2) {
    return null;
  }
  return splitTrailingEnter(input);
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
  return {
    glyph: `${claudeGlyphs().promptPointer} `,
    tone: "subtle",
    dim: input.busy,
  };
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
  const [textBuffer] = useState(() => new TextBuffer());
  const [inputHistory] = useState(() => new InputHistory());
  const lastEscapePressRef = useRef<number>(0);
  const handleTextBufferUpdateRef = useRef<() => void>(() => {});

  // Stable callback for TextBuffer state changes to prevent race conditions.
  // Finalized rapid input replaces the buffer wholesale, so it has to refresh
  // the slash palette and every other derived state, not just the text.
  const onStateChange = useCallback(() => {
    handleTextBufferUpdateRef.current();
  }, []);

  // Set up callback for when TextBuffer state changes (e.g., rapid input finalized)
  React.useEffect(() => {
    textBuffer.setStateChangeCallback(onStateChange);

    // Cleanup on unmount: clear any pending timers
    return () => {
      textBuffer.clear();
    };
  }, [textBuffer, onStateChange]);
  const [inputText, setInputText] = useState("");
  // The post-turn suggestion shown faint in the empty composer; Tab accepts it.
  const promptSuggestion = usePromptSuggestion();
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showSlashCommands, setShowSlashCommands] = useState(false);

  const [slashCommandFilter, setSlashCommandFilter] = useState("");
  /** Parent command when the palette has descended into its subcommands. */
  const [slashParent, setSlashParent] = useState<string | null>(null);
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

  // Update slash command UI state based on input
  const updateSlashCommandState = (text: string, cursor: number) => {
    // Only show slash commands if slash is the very first character
    if (!text.trimStart().startsWith("/")) {
      setShowSlashCommands(false);
      return;
    }

    // When using slash commands, disable file search
    setShowFileSearch(false);

    const trimmedText = text.trimStart();
    const beforeCursor = trimmedText.slice(
      0,
      cursor - (text.length - trimmedText.length),
    );

    // Only show if cursor is after the slash and before any whitespace
    if (beforeCursor.length === 0 || !beforeCursor.startsWith("/")) {
      setShowSlashCommands(false);
      return;
    }

    // Get the complete slash command from the text (not just before cursor)
    const commandText = trimmedText.slice(1);
    const afterSlash = commandText.split(/[\s\n]/)[0];
    const tokens = commandText.split(/[\s\n]+/).filter(Boolean);
    const endsWithSpace = /[\s\n]$/.test(trimmedText);

    // A parent command with subcommands descends once the path reaches it:
    // "/language" shows the command itself, "/language " (or a second token)
    // shows its children.
    if (tokens.length >= 2 || endsWithSpace) {
      const parent = slashCommands.find((cmd) => cmd.name === tokens[0]);
      if (parent?.subcommands) {
        const childFilter = tokens[1] ?? "";
        const matches = parent.subcommands.filter(
          (child) =>
            child.name.toLowerCase().includes(childFilter.toLowerCase()) ||
            child.description.toLowerCase().includes(childFilter.toLowerCase()),
        );
        // Past a known child, or nothing matches: fall back to normal input.
        if (tokens.length <= 2 && matches.length > 0) {
          setSlashParent(parent.name);
          setShowSlashCommands(true);
          setSlashCommandFilter(childFilter);
          setSelectedCommandIndex(0);
          setShowFileSearch(false);
          return;
        }
        setShowSlashCommands(false);
        return;
      }
    }
    setSlashParent(null);

    // We're in a slash command context - check if it's a complete command
    const exactMatch = slashCommands.find((cmd) => cmd.name === afterSlash);

    // Hide selector if we have an exact match and there's any additional content
    if (exactMatch) {
      // Check if there's anything after the command name (space + args)
      const commandWithSlash = "/" + exactMatch.name;
      const textAfterCommand = trimmedText.slice(commandWithSlash.length);

      // If there's any content after the command name (space + args), hide dropdown
      if (
        textAfterCommand.trim().length > 0 &&
        beforeCursor.length >= commandWithSlash.length
      ) {
        setShowSlashCommands(false);
        return;
      }
    }

    // Check if there are any matching commands
    const filteredCommands = slashCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(afterSlash.toLowerCase()) ||
        cmd.description.toLowerCase().includes(afterSlash.toLowerCase()),
    );

    // If no commands match, hide the dropdown to allow normal Enter behavior
    if (filteredCommands.length === 0) {
      setShowSlashCommands(false);
      return;
    }

    // Show selector for partial matches
    setShowSlashCommands(true);
    setSlashCommandFilter(afterSlash);
    setSelectedCommandIndex(0);
    setShowFileSearch(false);
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

    // Get ALL text after the @ symbol (including subsequent @ symbols)
    setShowFileSearch(true);
    setFileSearchFilter(text.slice(firstAtIndex + 1, cursor));
    setSelectedFileIndex(0);
    setShowSlashCommands(false);
    setShowBashMode(false);
  };

  // The list a level offers: the root commands, or a parent's children.
  const levelCommands = (): SlashCommand[] => {
    if (!slashParent) return slashCommands;
    const parent = slashCommands.find((cmd) => cmd.name === slashParent);
    return (parent?.subcommands ?? []).map((child) => ({
      name: child.name,
      description: child.description,
      category: "system" as const,
    }));
  };

  // The `@` list: files first, then agents, then MCP resources, built from the
  // live index and service state at the two points that need it.

  // Handle slash command selection
  const selectSlashCommand = (commandName: string) => {
    const beforeCursor = inputText.slice(0, cursorPosition);
    const lastSlashIndex = beforeCursor.lastIndexOf("/");

    if (lastSlashIndex !== -1) {
      const beforeSlash = inputText.slice(0, lastSlashIndex);
      const afterCursor = inputText.slice(cursorPosition);

      // Replace the partial command with the full command
      const newText = beforeSlash + "/" + commandName + " " + afterCursor;
      const newCursorPos = lastSlashIndex + 1 + commandName.length + 1;

      textBuffer.setText(newText);
      textBuffer.setCursor(newCursorPos);
      setInputText(newText);
      setCursorPosition(newCursorPos);
      setShowBashMode(false);
      // Recompute the level: completing a parent with children opens them.
      updateSlashCommandState(newText, newCursorPos);
    }
  };

  /**
   * Accept one row of the `@` list: replace the token before the cursor with
   * `@value`, keep one separating space after it, and attach a file when the
   * row names one. A directory completes without a space so the reader can
   * keep typing the rest of the path.
   */
  const acceptAtSuggestion = async (item: SuggestionItem) => {
    const firstAtIndex = activeFileSearchAtIndex(
      inputText.slice(0, cursorPosition),
    );
    if (firstAtIndex === -1) {
      return;
    }

    const beforeAt = inputText.slice(0, firstAtIndex);
    const afterCursor = inputText.slice(cursorPosition);
    const atEnd = afterCursor === "";
    const separator =
      item.isDirectory || (!atEnd && /^\s/.test(afterCursor)) ? "" : " ";
    const newText = beforeAt + "@" + item.insertText + separator + afterCursor;
    const newCursorPos =
      firstAtIndex + 1 + item.insertText.length + separator.length;

    textBuffer.setText(newText);
    textBuffer.setCursor(newCursorPos);
    setInputText(newText);
    setCursorPosition(newCursorPos);
    setShowFileSearch(false);

    if (item.filePath) {
      await attachFileContent(onFileAttached, item.filePath);
    }
  };

  const handleSlashCommandNavigation = (key: any): boolean => {
    const filteredCommands = filterCommandList(
      levelCommands(),
      slashCommandFilter,
    );

    if (key.upArrow) {
      setSelectedCommandIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCommands.length - 1,
      );
      return true;
    }

    if (key.downArrow) {
      setSelectedCommandIndex((prev) =>
        prev < filteredCommands.length - 1 ? prev + 1 : 0,
      );
      return true;
    }

    if ((key.return && !key.shift) || key.tab) {
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
        // A parent with children is completed (opening them), never submitted
        // alone; a leaf runs only once a prefix was deliberately typed.
        const hasChildren = (selected.subcommands?.length ?? 0) > 0;
        const canRun =
          key.return &&
          slashCommandFilter !== "" &&
          commandName !== "title" &&
          !hasChildren;

        if (slashParent && canRun) {
          // A child of the open level: run "/parent child".
          const commandText = `/${fullCommand}`;
          inputHistory.addEntry(commandText);
          if (!isRemoteMode && (isWaitingForResponse || isCompacting)) {
            void messageQueue.enqueueMessage(commandText);
          } else {
            onSubmit(commandText);
          }
          textBuffer.clear();
          setInputText("");
          setCursorPosition(0);
          setShowSlashCommands(false);
          setSlashParent(null);
          setShowBashMode(false);
        } else if (!slashParent && canRun) {
          // select and submit the command
          const commandText = "/" + commandName;
          inputHistory.addEntry(commandText);

          // queue up when responding/generating
          if (!isRemoteMode && (isWaitingForResponse || isCompacting)) {
            void messageQueue.enqueueMessage(commandText);
          } else {
            onSubmit(commandText);
          }

          // reset after submitting command
          textBuffer.clear();
          setInputText("");
          setCursorPosition(0);
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

  const handleFileSearchNavigation = (input: string, key: any): boolean => {
    const items = buildAtSuggestions({
      unified: unifiedSuggestionsAvailable,
      files: fileIndexState?.files ?? [],
      fallbackFiles: currentFiles,
      query: fileSearchFilter,
      agents: agentSources,
      mcp: mcpResources,
    });

    if (key.ctrl && input === "r") {
      void services.fileIndex.refreshIndex(true);
      return true;
    }

    if (key.upArrow) {
      setSelectedFileIndex((prev) =>
        prev > 0 ? prev - 1 : Math.max(0, items.length - 1),
      );
      return true;
    }

    if (key.downArrow) {
      setSelectedFileIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      return true;
    }

    if ((key.return && !key.shift) || key.tab) {
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
    textBuffer,
    inputHistory,
    inputText,
    setInputText,
    setCursorPosition,
    setShowSlashCommands,
    setShowFileSearch,
    refreshDerivedState: (text: string) => {
      updateSlashCommandState(text, text.length);
      updateFileSearchState(text, text.length);
      updateBashModeState(text);
    },
    inputMode,
    showSlashCommands,
    showFileSearch,
  });

  // Clear input function for Ctrl+C
  const clearInput = useCallback(() => {
    textBuffer.clear();
    setInputText("");
    setCursorPosition(0);
    setShowSlashCommands(false);
    setShowFileSearch(false);
    setShowBashMode(false);
    inputHistory.resetNavigation();
    historySearch.reset();
  }, [textBuffer, historySearch]);

  /**
   * Every key the composer answers before the buffer sees the input: the
   * history search, the open palette, mode cycling, escape, and the post-turn
   * suggestion. Returns false to hand the key to the buffer.
   */
  const dispatchComposerKeys = (input: string, key: any): boolean => {
    if (historySearch.search.active) {
      historySearch.handleKeys(input, key);
      return true;
    }
    if (historySearch.maybeOpen(input, key)) {
      return true;
    }
    if (key.tab && key.shift) {
      cycleModes();
      return true;
    }
    if (handleEscapeKey(input, key)) {
      return true;
    }
    if (showSlashCommands && handleSlashCommandNavigation(key)) {
      return true;
    }
    // A coalesced "text + Enter" read must not have its Enter left in the
    // buffer by a palette branch that declined to own it.
    if (coalescedEnterFor(input, key, textBuffer) && input === "/") {
      return false;
    }
    if (showFileSearch && handleFileSearchNavigation(input, key)) {
      return true;
    }
    if (!showSlashCommands && !showFileSearch) {
      const navigate = (entry: string | null) => {
        if (entry === null) return;
        textBuffer.setText(entry);
        textBuffer.setCursor(entry.length);
        setInputText(entry);
        setCursorPosition(entry.length);
      };
      if (key.upArrow) {
        navigate(inputHistory.navigateUp(inputText));
        return true;
      }
      if (key.downArrow) {
        navigate(inputHistory.navigateDown());
        return true;
      }
    }
    if (showSlashCommands || showFileSearch) {
      return false;
    }
    if (key.tab && promptSuggestion && inputText.length === 0) {
      const text = promptSuggestion.text;
      clearPromptSuggestion();
      textBuffer.setText(text);
      setInputText(text);
      setCursorPosition(text.length);
      return true;
    }
    if (!key.tab && input !== "" && promptSuggestion) {
      clearPromptSuggestion();
    }
    return false;
  };

  /** Enter submits, Shift+Enter breaks the line, the rest goes to the buffer. */
  const dispatchTextKeys = (input: string, key: any): void => {
    if (handleEnterKey(key)) {
      return;
    }
    // A terminal can deliver the typed run and the Enter together, and some
    // terminals send Enter as a bare "\n", which Ink also reports as not a
    // return key. Both must submit rather than insert a line break. Paste
    // mode and the rapid-input paste fallback own their newlines.
    const split = coalescedEnterFor(input, key, textBuffer);
    if (split) {
      if (split.body) {
        const handled = textBuffer.handleInput(split.body, key);
        updateTextBufferState({
          handled,
          textBuffer,
          setInputText,
          setCursorPosition,
          updateSlashCommandState,
          updateFileSearchState,
          updateBashModeState,
          inputHistory,
        });
      }
      handleEnterKey({ ...key, return: true, shift: false });
      return;
    }
    // "\r" and "\"+Enter break the line instead of submitting.
    const isNewLine = input === "\r" || input === "\\\r";
    const handled = textBuffer.handleInput(isNewLine ? "\n" : input, key);
    if (isNewLine && !handled) {
      return;
    }
    updateTextBufferState({
      handled,
      textBuffer,
      setInputText,
      setCursorPosition,
      updateSlashCommandState,
      updateFileSearchState,
      updateBashModeState,
      inputHistory,
    });
  };

  const handleEnterKey = (key: any): boolean => {
    if (key.return && !key.shift) {
      // Flush a stranded paste before submit so Enter does not send a blank
      // line while the silence timer still holds the real content.
      if (textBuffer.flushPasteMode()) {
        handleTextBufferUpdateRef.current();
      }
      if (textBuffer.text.trim() === "/") {
        return true;
      }
      // Check for backslash continuation
      const beforeCursor = textBuffer.text.slice(0, cursorPosition);
      const trimmedBeforeCursor = beforeCursor.trimEnd();

      if (trimmedBeforeCursor.endsWith("\\")) {
        // Handle backslash continuation: remove the trailing "\" and add newline
        const beforeBackslash = trimmedBeforeCursor.slice(0, -1);
        const afterCursor = textBuffer.text.slice(cursorPosition);
        const newText = beforeBackslash + "\n" + afterCursor;
        const newCursorPos = beforeBackslash.length + 1;

        textBuffer.setText(newText);
        textBuffer.setCursor(newCursorPos);
        setInputText(newText);
        setCursorPosition(newCursorPos);
        updateSlashCommandState(newText, newCursorPos);
        updateFileSearchState(newText, newCursorPos);
        return true;
      }

      // Normal Enter behavior - submit if there's content
      if (textBuffer.text.trim() || wasInterrupted) {
        // Get images before expanding paste blocks
        const imageMap = textBuffer.getAllImages();

        // Expand all paste blocks before submitting
        textBuffer.expandAllPasteBlocks();
        const submittedText = textBuffer.text.trim();

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

        textBuffer.clear();
        setInputText("");
        setCursorPosition(0);
        setShowSlashCommands(false);
        setShowBashMode(false);
      }
      return true;
    }
    return false;
  };

  const handleEscapeKey = (input: string, key: any): boolean => {
    const presses = escapePresses(input, key);
    if (presses === 0) return false;

    escapeEvents.emit("user-escape");

    // If only "!" is present, clear shell mode
    if (inputMode && showBashMode && inputText.trim() === "!") {
      textBuffer.clear();
      setInputText("");
      setCursorPosition(0);
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

    // Handle double Esc to open edit message selector
    const now = Date.now();
    const secondPress = presses >= 2 || now - lastEscapePressRef.current < 500;
    if (
      inputMode &&
      !showSlashCommands &&
      !showFileSearch &&
      !showBashMode &&
      onShowEditSelector &&
      secondPress
    ) {
      // Double escape detected
      onShowEditSelector();
      lastEscapePressRef.current = 0; // Reset to prevent triple-escape
      return true;
    }

    // Track single escape press
    lastEscapePressRef.current = now;

    return false;
  };

  // Handle text buffer updates for async operations like image pasting
  const handleTextBufferUpdate = () => {
    const newText = textBuffer.text;
    const newCursor = textBuffer.cursor;
    setInputText(newText);
    setCursorPosition(newCursor);
    updateSlashCommandState(newText, newCursor);
    updateFileSearchState(newText, newCursor);
    updateBashModeState(newText);
    inputHistory.resetNavigation();
  };
  handleTextBufferUpdateRef.current = handleTextBufferUpdate;

  // A queued message moved back for editing arrives as a one-shot draft.
  const pendingDraft = useComposerDraft();
  useEffect(() => {
    if (!pendingDraft) {
      return;
    }

    textBuffer.setText(pendingDraft.text);
    textBuffer.setCursor(pendingDraft.text.length);
    handleTextBufferUpdate();
    consumeComposerDraft(pendingDraft.id);
    // handleTextBufferUpdate reads the buffer that was just replaced; the
    // draft id is the only trigger.
  }, [pendingDraft, textBuffer]);

  const handleKeystroke = (input: string, key: any): void => {
    // Don't handle any input when disabled; the filter also stands down.
    // Ink splits a terminal reply at every ESC, so it consumes events one at
    // a time and decides whether they are a reply or ordinary keys.
    const currentInput = textBuffer.filterTerminalInput(input, disabled);

    // Mouse reports are handled by useMouseEvents; Ink also hands the raw
    // sequence to every useInput listener, where it would land in the prompt.
    if (currentInput === null || isTerminalMouseSequence(currentInput)) {
      return;
    }

    // Ctrl+C / Ctrl+D / Ctrl+P and the queued-message keys.
    if (
      handleControlKeys({
        input: currentInput,
        key,
        exit,
        clearInput,
        textBuffer,
        onTextBufferUpdate: handleTextBufferUpdate,
        queueActionsEnabled:
          !disabled &&
          !showFileSearch &&
          !showSlashCommands &&
          !historySearch.search.active,
        onOpenPalette,
      })
    ) {
      return;
    }

    // History search, palettes, modes, escape and the post-turn suggestion
    // own their keys before the buffer sees anything.
    if (dispatchComposerKeys(currentInput, key)) {
      return;
    }

    dispatchTextKeys(currentInput, key);
  };

  // Ink re-subscribes its input listener in an effect, so for a moment after a
  // render the listener still closes over the previous palette state. Enter
  // arriving in that window used to submit the raw "/language z" instead of
  // running the selected "zh-CN" child. The ref holds the closure from the
  // latest render, which is the state the frame on screen was drawn from.
  const handleKeystrokeRef = useRef(handleKeystroke);
  handleKeystrokeRef.current = handleKeystroke;
  useInput((input, key) => handleKeystrokeRef.current(input, key));

  const renderInputText = () => {
    // A post-turn suggestion takes the placeholder's place: it reads as a hint
    // of what to type next, and disappears the moment anything is typed.
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
    if (inputText.length === 0) {
      return (
        <>
          {(inputMode || isWaitingForResponse) && (
            <Text italic color="gray">
              ▋{placeholderText}
            </Text>
          )}
          {!inputMode && !isWaitingForResponse && (
            <Text italic color="gray">
              {placeholderText}
            </Text>
          )}
        </>
      );
    }

    if (inputMode || isWaitingForResponse) {
      // Handle multi-line text with cursor
      const lines = inputText.split("\n");
      let charCount = 0;
      let cursorLine = 0;
      let cursorCol = 0;

      // Find which line and column the cursor is on
      for (let i = 0; i < lines.length; i++) {
        if (cursorPosition <= charCount + lines[i].length) {
          cursorLine = i;
          cursorCol = cursorPosition - charCount;
          break;
        }
        charCount += lines[i].length + 1; // +1 for the newline character
      }

      // Handle cursor at the very end
      if (cursorPosition >= inputText.length) {
        cursorLine = lines.length - 1;
        cursorCol = lines[cursorLine].length;
      }

      return (
        <Box flexDirection="column">
          {lines.map((line, lineIndex) => {
            if (lineIndex === cursorLine) {
              // Line with cursor
              const beforeCursor = line.slice(0, cursorCol);
              const atCursor = line.slice(cursorCol, cursorCol + 1);
              const afterCursor = line.slice(cursorCol + 1);

              return (
                <Text key={lineIndex}>
                  {beforeCursor}
                  <Text inverse>{atCursor || " "}</Text>
                  {afterCursor}
                </Text>
              );
            } else {
              // Regular line - ensure empty lines still render
              return <Text key={lineIndex}>{line || " "}</Text>;
            }
          })}
        </Box>
      );
    } else {
      // Not in input mode, just display the text
      return (
        <Box flexDirection="column">
          {inputText.split("\n").map((line, index) => (
            <Text key={index}>{line || " "}</Text>
          ))}
        </Box>
      );
    }
  };

  // Don't render anything when disabled
  if (disabled) {
    return null;
  }

  const composerColor = showBashMode
    ? theme.status.warning
    : isRemoteMode
      ? theme.border.focus
      : theme.accent;

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
              !isRemoteMode &&
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

      {/* Goal, todos and running background work belong to the dock above the
          rule; the mode badge is embedded in the top rule. */}
      <GoalIndicator />

      <TodoIndicator />

      {/* Active mode is embedded in the composer's top rule; the rule below
          closes the frame. */}
      <ModeIndicator mode={currentMode} borderColor={composerColor} />

      {/* Keep the composer open on the sides; the mode and closing rules are
          the only frame lines. */}
      <Box>
        {/* A running turn fades the pointer, the same state as the spinner. */}
        <ComposerPrompt
          bash={showBashMode}
          remote={isRemoteMode}
          busy={isWaitingForResponse || isCompacting}
          subtle={theme.text.subtle}
          warning={theme.status.warning}
        />
        {renderInputText()}
      </Box>

      <Text color={composerColor}>{composeRule(columns)}</Text>
    </Box>
  );
};

export { UserInput };
