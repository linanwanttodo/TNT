import { useEffect, useRef, useState } from "react";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { shellCopy } from "../ui-copy.js";
import { useTerminalHistory } from "./useTerminalHistory.js";
import css from "../WorkspaceRail.module.css";

export function TerminalPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const history = useTerminalHistory();
  const logRef = useRef<HTMLDivElement | null>(null);

  const clear = () => setLines([]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const run = async () => {
    const command = input.trim();
    if (command === "" || busy) return;
    setInput("");
    setBusy(true);
    setLines((current) => [...current, `$ ${command}`]);
    history.append(command);
    try {
      const res = await fetch("/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const body = (await res.json()) as { output?: string; error?: string };
      setLines((current) => [
        ...current,
        body.output ?? body.error ?? "(no output)",
      ]);
    } catch (error) {
      setLines((current) => [
        ...current,
        error instanceof Error ? error.message : String(error),
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={css.terminal}>
      <div className={css.terminalLog} ref={logRef}>
        {lines.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
      <button type="button" className={css.terminalClear} onClick={clear}>
        {copy.clear}
      </button>
      <div className={css.terminalInput}>
        <input
          value={input}
          placeholder={copy.runCommand}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setInput(history.up() ?? input);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setInput(history.down() ?? "");
            }
          }}
        />
      </div>
    </div>
  );
}
