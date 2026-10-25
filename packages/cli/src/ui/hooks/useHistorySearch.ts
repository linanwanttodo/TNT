import { useState } from "react";

import type { InputHistory } from "../../utils/inputHistory.js";
import type { TextBuffer } from "../TextBuffer.js";

interface HistorySearchState {
  active: boolean;
  query: string;
  matches: string[];
  matchIndex: number;
  original: string;
}

const INACTIVE: HistorySearchState = {
  active: false,
  query: "",
  matches: [],
  matchIndex: -1,
  original: "",
};

interface HistorySearchOptions {
  textBuffer: TextBuffer;
  inputHistory: InputHistory;
  /** The box's current text, read when the search opens. */
  inputText: string;
  setInputText: (text: string) => void;
  setCursorPosition: (position: number) => void;
  setShowSlashCommands: (show: boolean) => void;
  setShowFileSearch: (show: boolean) => void;
  /** Re-derive the palette, file search and shell mode from the kept text. */
  refreshDerivedState: (text: string) => void;
  /** Ctrl+F only opens the search from the interactive composer. */
  inputMode: boolean;
  showSlashCommands: boolean;
  showFileSearch: boolean;
}

/**
 * Ctrl+F history search, in place: while active the box shows the match and
 * the caller renders a muted hint line with the query and the position.
 *
 * Ctrl+R already recalls the newest queued message, so the search lives on
 * the free Ctrl+F. Writing a candidate into the buffer deliberately skips
 * the palette and file-search derivation - a match starting with "/" or "@"
 * would otherwise open them mid-search - and re-derives once on exit.
 */
export function useHistorySearch(options: HistorySearchOptions) {
  const {
    textBuffer,
    inputHistory,
    inputText,
    setInputText,
    setCursorPosition,
    setShowSlashCommands,
    setShowFileSearch,
    refreshDerivedState,
    inputMode,
    showSlashCommands,
    showFileSearch,
  } = options;
  const [search, setSearch] = useState<HistorySearchState>(INACTIVE);

  const showMatch = (entry: string) => {
    textBuffer.setText(entry);
    textBuffer.setCursor(entry.length);
    setInputText(entry);
    setCursorPosition(entry.length);
  };

  const open = () => {
    const matches = inputHistory
      .searchMatches(inputText)
      .map((entry) => entry.text);
    setSearch({
      active: true,
      query: inputText,
      matches,
      matchIndex: matches.length > 0 ? 0 : -1,
      original: inputText,
    });
    if (matches.length > 0) {
      showMatch(matches[0]);
    }
    setShowSlashCommands(false);
    setShowFileSearch(false);
  };

  const exit = (kept: string) => {
    showMatch(kept);
    setSearch(INACTIVE);
    refreshDerivedState(kept);
  };

  const refresh = (query: string, fallback: string) => {
    const matches = inputHistory
      .searchMatches(query)
      .map((entry) => entry.text);
    setSearch((previous) => ({
      ...previous,
      query,
      matches,
      matchIndex: matches.length > 0 ? 0 : -1,
    }));
    // No match leaves the pre-search text in the box: the hint line says
    // 0/0, and the box keeps showing what a cancel would restore.
    showMatch(matches.length > 0 ? matches[0] : fallback);
  };

  /** Opens the search from an idle composer; false when the key was not it. */
  const maybeOpen = (input: string, key: any): boolean => {
    if (
      key.ctrl &&
      input === "f" &&
      inputMode &&
      !showSlashCommands &&
      !showFileSearch
    ) {
      open();
      return true;
    }
    return false;
  };

  const reset = () => {
    setSearch(INACTIVE);
  };

  /** Handles one key while active; every key is consumed. */
  const handleKeys = (input: string, key: any) => {
    // Ctrl+F walks to the next-older match, stopping at the oldest.
    if (key.ctrl && input === "f") {
      if (
        search.matches.length > 0 &&
        search.matchIndex < search.matches.length - 1
      ) {
        const next = search.matchIndex + 1;
        showMatch(search.matches[next]);
        setSearch({ ...search, matchIndex: next });
      }
      return;
    }

    if (key.escape) {
      exit(search.original);
      return;
    }

    // Enter keeps whatever the box shows: the selected match, or the
    // original when nothing matched. Selecting is not submitting.
    if (key.return && !key.shift) {
      exit(inputText);
      return;
    }

    if (key.backspace || key.delete) {
      if (search.query.length > 0) {
        refresh(search.query.slice(0, -1), search.original);
      }
      return;
    }

    // Printable input extends the query; arrows and everything else are
    // swallowed so they cannot move the box out from under the match.
    if (
      !key.ctrl &&
      !key.meta &&
      !key.tab &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow &&
      input.length >= 1
    ) {
      refresh(search.query + input, search.original);
    }
  };

  return { search, maybeOpen, handleKeys, reset };
}
