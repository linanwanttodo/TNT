/** Assistant reasoning disclosure, adapted from dsh ui-chat's ReasoningRow. */
import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
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
