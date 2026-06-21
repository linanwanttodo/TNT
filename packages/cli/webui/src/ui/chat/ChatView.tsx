/** The conversation transcript: settled items, streaming tail, notices, approval. */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatItem,
  PendingPermission,
  PendingQuestionState,
} from "../../stores/session-store.js";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ChatItemView } from "./ChatItemView.tsx";
import { ChatLoading } from "./ChatLoading.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { ReasoningRow } from "./ReasoningRow.tsx";
import css from "./ChatView.module.css";

interface MessageMark {
  top: number;
  preview: string;
}

function previewOf(item: ChatItem): string {
  if (item.kind === "message") return item.text;
  if (item.kind === "reasoning") return item.text;
  if (item.kind === "tool") return item.toolName;
  return item.text;
}

export function ChatView({
  items,
  streaming,
  isStreaming = false,
  reasoning,
  pendingPermission,
  pendingQuestion = null,
  notices,
  isWaiting = false,
  turnStartedAt = null,
  onAnswer,
  onAnswerQuestion = () => {},
}: {
  items: ChatItem[];
  streaming: string | null;
  isStreaming?: boolean | undefined;
  reasoning: string | null;
  pendingPermission: PendingPermission | null;
  pendingQuestion?: PendingQuestionState | null;
  notices: string[];
  isWaiting?: boolean | undefined;
  turnStartedAt?: number | null | undefined;
  onAnswer: (approved: boolean) => void;
  onAnswerQuestion?: ((answer: string) => void) | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tailKey = `${items.length}:${streaming?.length ?? 0}:${reasoning?.length ?? 0}`;
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const [marks, setMarks] = useState<MessageMark[]>([]);
  const [showJump, setShowJump] = useState(false);

  const measure = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll === null || items.length === 0) {
      setMarks([]);
      return;
    }
    const scale = (scroll.clientHeight / scroll.scrollHeight) * 100;
    setMarks(
      items.map((item, index) => {
        const element = itemRefs.current.get(index);
        return {
          top: element ? element.offsetTop * scale : 0,
          preview: previewOf(item).slice(0, 140),
        };
      }),
    );
  }, [items]);

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

  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    const scroll = scrollRef.current;
    const onScroll = () => {
      measure();
      const distance = scroll
        ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
        : 0;
      setShowJump(distance > 240);
    };
    scroll?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      scroll?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const jumpTo = (index: number) => {
    itemRefs.current.get(index)?.scrollIntoView({ block: "start" });
  };

  const jumpToLatest = () => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  };

  return (
    <div className={css.frame}>
      <div className={css.scroll} ref={scrollRef}>
        <div className={css.content}>
          {notices.map((notice, i) => (
            <div
              key={i}
              className={css.notice}
              data-zcode-stream-animate="true"
            >
              {notice}
            </div>
          ))}
          {items.map((item, i) => (
            <div
              key={i}
              ref={(element) => {
                if (element) itemRefs.current.set(i, element);
                else itemRefs.current.delete(i);
              }}
            >
              <ChatItemView item={item} />
            </div>
          ))}
          {reasoning !== null && <ReasoningRow text={reasoning} running />}
          {streaming !== null && (
            <div className={css.streaming} data-zcode-stream-animate="true">
              <ChatItemView
                item={{
                  kind: "message",
                  role: "assistant",
                  text: streaming,
                  streaming: isStreaming,
                }}
              />
            </div>
          )}
          {isWaiting &&
          items.length === 0 &&
          streaming === null &&
          reasoning === null ? (
            <ChatLoading
              loading={isWaiting}
              initialElapsedMs={
                turnStartedAt !== null
                  ? Math.max(0, Date.now() - turnStartedAt)
                  : 0
              }
            />
          ) : null}
          {pendingQuestion !== null && (
            <QuestionCard
              pending={pendingQuestion}
              onAnswer={(answer) => void onAnswerQuestion?.(answer)}
            />
          )}
          {pendingPermission !== null && (
            <ApprovalCard pending={pendingPermission} onAnswer={onAnswer} />
          )}
        </div>
      </div>
      <div className={css.messageRail}>
        {marks.map((mark, index) => (
          <button
            key={index}
            type="button"
            className={css.railTick}
            style={{ top: `${mark.top}%` }}
            title={mark.preview}
            aria-label={`Jump to message ${index + 1}`}
            onClick={() => jumpTo(index)}
          />
        ))}
      </div>
      {showJump ? (
        <button
          type="button"
          className={css.jumpToLatest}
          aria-label="Jump to latest message"
          onClick={jumpToLatest}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M8 2v10M3.5 8.5 8 13l4.5-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
