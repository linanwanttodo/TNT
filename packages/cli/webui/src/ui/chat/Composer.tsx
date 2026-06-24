/**
 * The composer: a fully-rounded pill field, Cursor-style. The plus on the
 * left opens the settings menu (new session, mode and session facts); the
 * circular up arrow on the right sends, and becomes a stop while a turn runs.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  IconPlusOutlineMedium,
  IconSendOutlineRegular,
  IconStopFillRegular,
} from "../primitives/index.ts";
import css from "./Composer.module.css";
import { chatLabels } from "./labels.js";

const LINE_HEIGHT = 24;
/** Mirrors the composer's own max-height: past it the field scrolls. */
const MAX_INPUT_HEIGHT = 120;

/** One line is a capsule; anything taller is a rounded rectangle. */
export function composerShape(
  contentHeight: number,
  lineHeight: number,
): "pill" | "card" {
  return contentHeight > lineHeight ? "card" : "pill";
}

export function Composer({
  waiting,
  idle = false,
  onSend,
  onStop,
  onOpenMenu,
  draft,
  onDraftUsed,
}: {
  waiting: boolean;
  /** True when the session has history but no turn is running: shows play. */
  idle?: boolean | undefined;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The leading plus opens the settings menu anchored to the composer. */
  onOpenMenu: () => void;
  /** Text set from outside (a suggestion card); consumed once. */
  draft?: string | null | undefined;
  /** Called after the draft has been taken into the field. */
  onDraftUsed?: (() => void) | undefined;
}) {
  const [text, setText] = useState("");
  const [shape, setShape] = useState<"pill" | "card">("pill");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft === null || draft === undefined) return;
    setText(draft);
    onDraftUsed?.();
    inputRef.current?.focus();
  }, [draft, onDraftUsed]);

  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "0px";
    const grown = Math.min(field.scrollHeight, MAX_INPUT_HEIGHT);
    field.style.height = `${grown}px`;
    setShape(composerShape(grown, LINE_HEIGHT));
  }, [text]);

  const submit = () => {
    if (waiting || text.trim() === "") return;
    onSend(text);
    setText("");
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const hasText = text.trim() !== "";

  return (
    <div className={css.frame}>
      <div className={css.box} data-shape={shape}>
        <button
          type="button"
          className={css.leading}
          aria-label={chatLabels.menuLabel}
          onClick={onOpenMenu}
        >
          <IconPlusOutlineMedium size={16} />
        </button>
        <textarea
          ref={inputRef}
          className={css.input}
          value={text}
          rows={1}
          aria-label={chatLabels.inputAria}
          placeholder={chatLabels.inputPlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keydown}
        />
        {waiting ? (
          <button
            type="button"
            className={css.action}
            aria-label={chatLabels.stopLabel}
            data-state="stop"
            onClick={onStop}
          >
            <IconStopFillRegular size={14} />
          </button>
        ) : (
          <button
            type="button"
            className={css.action}
            aria-label={
              idle && !hasText ? "Continue session" : chatLabels.sendLabel
            }
            data-ready={idle && !hasText ? true : hasText}
            data-play={idle && !hasText ? "" : undefined}
            onClick={idle && !hasText ? () => onSend("Continue") : submit}
          >
            {idle && !hasText ? (
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden="true"
              >
                <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
              </svg>
            ) : (
              <IconSendOutlineRegular size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
