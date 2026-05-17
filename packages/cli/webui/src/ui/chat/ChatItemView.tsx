/** One settled conversation item; the streaming tail is rendered separately. */
import { parsePatch } from "diff";

import type {
  AssistantMessageItem,
  ChatItem,
  ErrorItem,
  ToolCardItem,
  UserMessageItem,
} from "../../stores/session-store.js";
import { DiffBlock, type DiffHunk } from "../primitives/DiffBlock.tsx";
import { MarkdownText } from "../primitives/markdown/MarkdownText.tsx";
import { UserMessageBubble } from "../primitives/UserMessageBubble.tsx";
import css from "./ChatItemView.module.css";
import { diffLabels, markdownLabels } from "./labels.js";

export function ChatItemView({ item }: { item: ChatItem }) {
  if (item.kind === "message") {
    return item.role === "user" ? (
      <UserRow item={item} />
    ) : (
      <AssistantRow item={item} />
    );
  }
  if (item.kind === "tool") {
    return <ToolRow item={item} />;
  }
  return <ErrorRow item={item} />;
}

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
        <MarkdownText text={item.text} labels={markdownLabels} />
      )}
    </div>
  );
}

function ToolRow({ item }: { item: ToolCardItem }) {
  const done = item.status === "done";
  const failed = item.status === "errored" || item.status === "canceled";
  const target = toolTarget(item.args);
  const diffs = item.result === undefined ? [] : hunksFromDiff(item.result);
  return (
    <div className={css.toolRow} data-status={item.status}>
      <span
        className={css.toolDot}
        data-kind={done ? "done" : failed ? "failed" : "running"}
      />
      <div className={css.toolBody}>
        <span className={css.toolName}>
          {item.toolName}
          {target !== null && <code className={css.toolTarget}>{target}</code>}
        </span>
        {item.result !== undefined &&
          (diffs.length > 0 ? (
            <DiffBlock diffs={diffs} labels={diffLabels} />
          ) : (
            <pre className={css.toolResult}>{item.result}</pre>
          ))}
      </div>
    </div>
  );
}

/**
 * Rebuild both sides of every hunk so the diff surface owns the rendering.
 * parsePatch reads non-patch text as one file with no hunks, so the hunk count
 * is what separates a real diff from command output.
 * @param result - the tool's text result.
 * @returns one entry per hunk, empty for anything that is not a diff.
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

/** The argument names a call operates on, in the order the tools fill them. */
const TOOL_TARGET_KEYS = [
  "file_path",
  "path",
  "command",
  "query",
  "pattern",
  "url",
];

/**
 * The one thing a tool call acted on, so the card reads as an action rather
 * than a bare tool name. Args outside the known keys render nothing: a raw
 * JSON dump is what the card did before, and it is unreadable.
 * @param args - the call's arguments as the engine reported them.
 * @returns the target text, or null when no known key carries one.
 */
function toolTarget(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const record = args as Record<string, unknown>;
  for (const key of TOOL_TARGET_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function ErrorRow({ item }: { item: ErrorItem }) {
  return (
    <div className={css.errorRow} role="alert">
      {item.text}
    </div>
  );
}
