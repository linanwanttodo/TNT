import { useRef, useState } from "react";

import type { InputHistory } from "../../utils/inputHistory.js";
import type { TextBuffer } from "../components/text-buffer.js";

import type { Key } from "./useKeypress.js";

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
  buffer: TextBuffer;
  inputHistory: InputHistory;
  /** The box's current text, read when the search opens. */
  inputText: string;
  setInputText: (text: string) => void;
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
    buffer,
    inputHistory,
    inputText,
    setInputText,
    setShowSlashCommands,
    setShowFileSearch,
    refreshDerivedState,
    inputMode,
    showSlashCommands,
    showFileSearch,
  } = options;
  const [search, setSearch] = useState<HistorySearchState>(INACTIVE);
  // A single stdin read can carry a whole word: React commits once, so
  // handlers must accumulate the query against a live ref instead of the
  // render-time state snapshot.
  const liveRef = useRef(search);
  liveRef.current = search;
  const apply = (next: HistorySearchState) => {
    liveRef.current = next;
    setSearch(next);
  };

  const showMatch = (entry: string) => {
    buffer.setText(entry, "end");
    setInputText(entry);
  };

  const open = () => {
    const matches = inputHistory
      .searchMatches(inputText)
      .map((entry) => entry.text);
    apply({
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
    apply(INACTIVE);
    refreshDerivedState(kept);
  };

  const refresh = (query: string, fallback: string) => {
    const matches = inputHistory
      .searchMatches(query)
      .map((entry) => entry.text);
    apply({
      ...liveRef.current,
      query,
      matches,
      matchIndex: matches.length > 0 ? 0 : -1,
    });
    // No match leaves the pre-search text in the box: the hint line says
    // 0/0, and the box keeps showing what a cancel would restore.
    showMatch(matches.length > 0 ? matches[0] : fallback);
  };

  /** Opens the search from an idle composer; false when the key was not it. */
  const maybeOpen = (key: Key): boolean => {
    if (
      key.ctrl &&
      key.name === "f" &&
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
    apply(INACTIVE);
  };

  /** Handles one key while active; every key is consumed. */
  const handleKeys = (key: Key) => {
    const current = liveRef.current;

    // Ctrl+F walks to the next-older match, stopping at the oldest.
    if (key.ctrl && key.name === "f") {
      if (
        current.matches.length > 0 &&
        current.matchIndex < current.matches.length - 1
      ) {
        const next = current.matchIndex + 1;
        showMatch(current.matches[next]);
        apply({ ...current, matchIndex: next });
      }
      return;
    }

    if (key.name === "escape") {
      exit(current.original);
      return;
    }

    // Enter keeps whatever the box shows: the selected match, or the
    // original when nothing matched. Selecting is not submitting.
    if (key.name === "enter" && !key.shift) {
      exit(inputText);
      return;
    }

    if (key.name === "backspace" || key.name === "delete") {
      if (current.query.length > 0) {
        refresh(current.query.slice(0, -1), current.original);
      }
      return;
    }

    // Printable input extends the query; arrows and everything else are
    // swallowed so they cannot move the box out from under the match.
    if (
      !key.ctrl &&
      !key.cmd &&
      !key.alt &&
      key.name !== "tab" &&
      key.name !== "up" &&
      key.name !== "down" &&
      key.name !== "left" &&
      key.name !== "right" &&
      key.insertable &&
      key.sequence.length >= 1
    ) {
      refresh(current.query + key.sequence, current.original);
      return;
    }
  };

  return { search, maybeOpen, handleKeys, reset };
}
