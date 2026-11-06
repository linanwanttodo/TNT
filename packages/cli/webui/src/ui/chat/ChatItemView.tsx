/** One settled conversation item; the streaming tail is rendered separately. */
import { memo, useEffect, useState } from "react";

import { parsePatch } from "diff";

import type {
  AssistantMessageItem,
  ChatItem,
  ErrorItem,
  ToolCardItem,
  UserMessageItem,
} from "../../stores/session-store.js";
import { ChangedFilesPill } from "./ChangedFilesPill.tsx";
import { MarkdownText } from "../primitives/markdown/MarkdownText.tsx";
import { ReasoningRow } from "./ReasoningRow.tsx";
import { UserMessageBubble } from "../primitives/UserMessageBubble.tsx";
import { DiffBlock, type DiffHunk } from "../primitives/DiffBlock.tsx";
import { diffLabels } from "./labels.js";
import { IconChevronRightOutlineRegular } from "../primitives/icons/index.tsx";
import css from "./ChatItemView.module.css";
import { markdownLabels } from "./labels.js";
import { changedPaths } from "./changedFiles.js";
import { toolArguments } from "./changedFiles.js";

/**
 * Rebuild both sides of every hunk so the diff surface owns the rendering.
 * parsePatch reads non-patch text as one file with no hunks, so the hunk count
 * is what separates a real diff from command output.
 */
function hunksFromDiff(result: string): DiffHunk[] {
  try {
    return parsePatch(result).flatMap((file) =>
      file.hunks.map((hunk) => {
        const oldSide: string[] = [];
        const newSide: string[] = [];
        for (const line of hunk.lines) {
          const body = line.slice(1);
          if (line.startsWith("+")) newSide.push(body);
          else if (line.startsWith("-")) oldSide.push(body);
          else {
            oldSide.push(body);
            newSide.push(body);
          }
        }
        return {
          path: (file.newFileName ?? "").replace(/^b\//, ""),
          oldText: oldSide.join("\n"),
          newText: newSide.join("\n"),
        };
      }),
    );
  } catch {
    // A truncated or hand-written header that disagrees with its own lines is
    // common in tool output; losing the coloring beats losing the transcript.
    return [];
  }
}

// Settled items never change once landed; memo keeps a streaming reply from
// re-rendering the whole transcript on every delta.
export const ChatItemView = memo(function ChatItemView({
  item,
}: {
  item: ChatItem;
}) {
  if (item.kind === "message") {
    return item.role === "user" ? (
      <UserRow item={item} />
    ) : (
      <AssistantRow item={item} />
    );
  }
  if (item.kind === "reasoning") {
    return <ReasoningRow text={item.text} running={false} />;
  }
  if (item.kind === "tool") {
    return <ToolRow item={item} />;
  }
  return <ErrorRow item={item} />;
});

function UserRow({ item }: { item: UserMessageItem }) {
  return (
    <div className={css.userRow}>
      <UserMessageBubble className={css.userBubble}>
        {item.text}
      </UserMessageBubble>
    </div>
  );
}

function AssistantRow({ item }: { item: AssistantMessageItem }) {
  return (
    <div className={css.assistantRow}>
      {item.text !== "" && (
        <MarkdownText
          text={item.text}
          streaming={item.streaming === true}
          labels={markdownLabels}
        />
      )}
      {item.changedFiles && item.changedFiles.length > 0 ? (
        <ChangedFilesPill files={item.changedFiles} />
      ) : null}
    </div>
  );
}

function ToolRow({ item }: { item: ToolCardItem }) {
  const done = item.status === "done";
  const failed = item.status === "errored" || item.status === "canceled";
  const running = !done && !failed;
  const [open, setOpen] = useState(!done);
  const [touched, setTouched] = useState(false);
  const changed = changedPaths(item.toolName, item.args);
  const summary =
    changed.length > 0
      ? `${changed.length} ${changed.length === 1 ? "file" : "files"}`
      : (toolArguments(item.toolName, item.args) ??
        (item.result && item.result.length > 80
          ? `${item.result.slice(0, 80)}...`
          : item.result));

  // A running card shows its output as it lands; the desktop collapses the
  // row once the operation finishes, unless the reader opened or closed it.
  useEffect(() => {
    if (touched) return;
    setOpen(!done);
  }, [done, touched]);

  return (
    <div className={css.toolRow} data-status={item.status}>
      <span
        className={css.toolDot}
        data-kind={done ? "done" : failed ? "failed" : "running"}
      />
      <div className={css.toolBody}>
        <button
          type="button"
          className={css.toolToggle}
          aria-expanded={open}
          onClick={() => {
            setTouched(true);
            setOpen((value) => !value);
          }}
        >
          <IconChevronRightOutlineRegular
            size={12}
            className={css.toolCaret}
            data-open={open}
          />
          <span className={css.toolName}>{item.toolName}</span>
          {summary ? <span className={css.toolSummary}>{summary}</span> : null}
          {running ? <span className={css.toolPending} /> : null}
        </button>
        <div className={css.toolPanel} data-open={open}>
          <div className={css.toolPanelInner}>
            {item.result !== undefined &&
              (() => {
                const diffs = hunksFromDiff(item.result);
                return diffs.length > 0 ? (
                  <DiffBlock diffs={diffs} labels={diffLabels} />
                ) : (
                  <pre className={css.toolResult}>{item.result}</pre>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorRow({ item }: { item: ErrorItem }) {
  return (
    <div className={css.errorRow} role="alert">
      {item.text}
    </div>
  );
}
