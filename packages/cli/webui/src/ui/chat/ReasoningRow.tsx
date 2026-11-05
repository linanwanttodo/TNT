/** Assistant reasoning disclosure, adapted from dsh ui-chat's ReasoningRow. */
import { useEffect, useState } from "react";
import { DisclosureRow, IconThinkOutlineRegular } from "../primitives/index.ts";
import { MarkdownText } from "../primitives/markdown/MarkdownText.tsx";
import css from "./ReasoningRow.module.css";
import { chatLabels, markdownLabels } from "./labels.js";

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

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}
