import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { env } from "../config/env.js";

const MAX_HISTORY_SIZE = 1000;

/**
 * The file this process records submitted lines in. Tests set
 * TNT_INPUT_HISTORY_DIR per case so concurrent cases on one worker never
 * share a file; unset, it is the user's global dir.
 */
function resolveHistoryFile(): string {
  const dir = process.env.TNT_INPUT_HISTORY_DIR;
  return dir
    ? path.join(dir, "input_history.json")
    : path.join(env.continueHome, "input_history.json");
}

export interface InputHistoryEntry {
  text: string;
  timestamp: number;
}

export class InputHistory {
  private history: InputHistoryEntry[] = [];
  private currentIndex: number = -1;
  private originalInput: string = "";
  private readonly historyFile: string;

  constructor(historyFile: string = resolveHistoryFile()) {
    this.historyFile = historyFile;
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, "utf8");
        this.history = JSON.parse(data);
      }
    } catch (error) {
      console.error("Failed to load input history:", error);
      this.history = [];
    }
  }

  /**
   * Writes this instance's entries over the file, keeping entries another
   * instance added in the meantime. The file is a shared record, not this
   * object's private state: a second CLI window that submits a line while
   * this one runs must still find it in the file after both save. The merged
   * view is what lands on disk and what this instance keeps navigating.
   */
  private saveHistory(): void {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const onDisk = this.readEntriesFromDisk();
      const seen = new Set(this.history.map((entry) => entry.text));
      const merged = [...this.history];
      for (const entry of onDisk) {
        if (!seen.has(entry.text)) {
          merged.push(entry);
        }
      }
      merged.sort((a, b) => b.timestamp - a.timestamp);

      this.history = merged.slice(0, MAX_HISTORY_SIZE);
      writeFileAtomically(
        this.historyFile,
        JSON.stringify(this.history, null, 2),
      );
    } catch (error) {
      console.error("Failed to save input history:", error);
    }
  }

  private readEntriesFromDisk(): InputHistoryEntry[] {
    try {
      if (!fs.existsSync(this.historyFile)) {
        return [];
      }
      const data = fs.readFileSync(this.historyFile, "utf8");
      const parsed: unknown = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as InputHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  addEntry(text: string): void {
    if (!text.trim()) return;

    // Remove duplicate if it exists
    this.history = this.history.filter((entry) => entry.text !== text);

    // Add new entry at the beginning
    this.history.unshift({
      text,
      timestamp: Date.now(),
    });

    // Limit history size
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(0, MAX_HISTORY_SIZE);
    }

    this.saveHistory();
    this.resetNavigation();
  }

  navigateUp(currentInput: string): string | null {
    if (this.history.length === 0) return null;

    // Store original input on first navigation
    if (this.currentIndex === -1) {
      this.originalInput = currentInput;
      this.currentIndex = 0;
    } else if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
    }

    return this.history[this.currentIndex]?.text || null;
  }

  navigateDown(): string | null {
    if (this.currentIndex === -1) return null;

    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex]?.text || null;
    } else {
      // Return to original input
      const originalInput = this.originalInput;
      this.resetNavigation();
      return originalInput;
    }
  }

  resetNavigation(): void {
    this.currentIndex = -1;
    this.originalInput = "";
  }

  /**
   * The entries containing `query`, case-insensitive, newest first. The
   * caller owns the position within the result; this only answers what the
   * result set is.
   */
  searchMatches(query: string): InputHistoryEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.history.filter((entry) =>
      entry.text.toLowerCase().includes(needle),
    );
  }

  getHistory(): InputHistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
    this.resetNavigation();
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      writeFileAtomically(this.historyFile, "[]");
    } catch (error) {
      console.error("Failed to save input history:", error);
    }
  }
}
