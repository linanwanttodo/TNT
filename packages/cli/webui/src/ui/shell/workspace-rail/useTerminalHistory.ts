import { useState } from "react";

const STORAGE_KEY = "tnt-webui-terminal-history";

function readHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function useTerminalHistory() {
  const [history, setHistory] = useState<string[]>(readHistory);
  const [index, setIndex] = useState<number | null>(null);

  const append = (command: string) => {
    const next = [...history, command].slice(-100);
    setHistory(next);
    setIndex(null);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const up = () => {
    if (history.length === 0) return;
    const next = index === null ? history.length - 1 : Math.max(0, index - 1);
    setIndex(next);
    return history[next];
  };

  const down = () => {
    if (index === null) return;
    const next = index + 1;
    if (next >= history.length) {
      setIndex(null);
      return "";
    }
    setIndex(next);
    return history[next];
  };

  return { append, up, down };
}
