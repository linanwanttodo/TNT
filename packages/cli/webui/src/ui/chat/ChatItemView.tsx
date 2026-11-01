/** One settled conversation item; the streaming tail is rendered separately. */
import type {
  AssistantMessageItem,
  ChatItem,
  ErrorItem,
  ToolCardItem,
  UserMessageItem,
} from "../../stores/session-store.js";
import { MarkdownText } from "../primitives/markdown/MarkdownText.tsx";
import { UserMessageBubble } from "../primitives/UserMessageBubble.tsx";
import css from "./ChatItemView.module.css";
import { markdownLabels } from "./labels.js";

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
  return (
    <div className={css.toolRow} data-status={item.status}>
      <span
        className={css.toolDot}
        data-kind={done ? "done" : failed ? "failed" : "running"}
      />
      <div className={css.toolBody}>
        <span className={css.toolName}>{item.toolName}</span>
        {item.result !== undefined && (
          <pre className={css.toolResult}>{item.result}</pre>
        )}
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
