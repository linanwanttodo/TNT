/** Assistant reasoning disclosure, adapted from dsh ui-chat's ReasoningRow. */
import { useEffect, useRef, useState } from "react";
import { DisclosureRow, IconThinkOutlineRegular } from "../primitives/index.ts";
import { MarkdownText } from "../primitives/markdown/MarkdownText.tsx";
import css from "./ReasoningRow.module.css";
import { chatLabels, markdownLabels } from "./labels.js";

/**
 * Duration badge, ported from ZCode's Reasoning: the seconds the model spent
 * thinking, ticked locally so the transcript does not re-render every 100ms
 * with it.
 */
function useThinkingDuration(running: boolean): number | null {
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (running) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now();
      const timer = window.setInterval(() => {
        if (startedAtRef.current !== null) {
          setElapsedMs(Date.now() - startedAtRef.current);
        }
      }, 1000);
      return () => window.clearInterval(timer);
    }
    if (startedAtRef.current !== null) {
      setElapsedMs(Date.now() - startedAtRef.current);
    }
    return undefined;
  }, [running]);

  if (running && startedAtRef.current === null) return null;
  return Math.max(1, Math.round(elapsedMs / 1000));
}

export function ReasoningRow({
  text,
  running,
}: {
  text: string;
  running: boolean;
}) {
  // Open while the model is still writing, folded once it stopped: a reader
  // watches the thinking as it happens and gets the answer's room back after.
  const [expanded, setExpanded] = useState(running);
  useEffect(() => {
    if (!running) setExpanded(false);
  }, [running]);
  const seconds = useThinkingDuration(running);
  return (
    <div className={css.root} data-expanded={expanded || undefined}>
      <DisclosureRow
        open={expanded}
        expandable
        running={running}
        onToggle={() => setExpanded((e) => !e)}
        icon={
          <span className={css.thinkIcon}>
            <IconThinkOutlineRegular size={14} />
          </span>
        }
        title={chatLabels.reasoningTitle}
        headerAccessory={
          seconds !== null ? (
            <span className={css.duration} title={`${seconds}s thinking`}>
              {formatDuration(seconds)}
            </span>
          ) : null
        }
        collapsedContent={
          <span className={running ? css.summaryRunning : css.summary}>
            {firstLine(text)}
          </span>
        }
      >
        <div className={css.body}>
          <MarkdownText
            text={text}
            streaming={running}
            labels={markdownLabels}
            variant="compact"
          />
        </div>
      </DisclosureRow>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}
