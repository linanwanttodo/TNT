/** The conversation transcript: settled items, streaming tail, notices, approval. */
import { useEffect, useRef } from "react";
import type {
  ChatItem,
  PendingPermission,
} from "../../stores/session-store.js";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ChatItemView } from "./ChatItemView.tsx";
import { ReasoningRow } from "./ReasoningRow.tsx";
import css from "./ChatView.module.css";

export function ChatView({
  items,
  streaming,
  reasoning,
  pendingPermission,
  notices,
  onAnswer,
}: {
  items: ChatItem[];
  streaming: string | null;
  reasoning: string | null;
  pendingPermission: PendingPermission | null;
  notices: string[];
  onAnswer: (approved: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tailKey = `${items.length}:${streaming?.length ?? 0}:${reasoning?.length ?? 0}`;

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    // Follow the tail only for a reader already at it; someone scrolled up
    // re-reading keeps their place until they return.
    const distance =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    if (distance < 80) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, [tailKey]);

  return (
    <div className={css.frame}>
      <div className={css.scroll} ref={scrollRef}>
        <div className={css.content}>
          {notices.map((notice, i) => (
            <div key={i} className={css.notice}>
              {notice}
            </div>
          ))}
          {items.map((item, i) => (
            <ChatItemView key={i} item={item} />
          ))}
          {reasoning !== null && <ReasoningRow text={reasoning} running />}
          {streaming !== null && (
            <div className={css.streaming}>
              <ChatItemView
                item={{ kind: "message", role: "assistant", text: streaming }}
              />
            </div>
          )}
          {pendingPermission !== null && (
            <ApprovalCard pending={pendingPermission} onAnswer={onAnswer} />
          )}
        </div>
      </div>
    </div>
  );
}
