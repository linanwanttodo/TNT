/**
 * The composer: a fully-rounded pill field, Cursor-style. The plus on the
 * left opens the settings menu (new session, mode and session facts); the
 * circular up arrow on the right sends, and becomes a stop while a turn runs.
 */
import { useState, type KeyboardEvent } from "react";
import {
  IconPlusOutlineMedium,
  IconSendOutlineRegular,
  IconStopFillRegular,
} from "../primitives/index.ts";
import css from "./Composer.module.css";
import { chatLabels } from "./labels.js";

export function Composer({
  waiting,
  onSend,
  onStop,
  onOpenMenu,
}: {
  waiting: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The leading plus opens the settings menu anchored to the composer. */
  onOpenMenu: () => void;
}) {
  const [text, setText] = useState("");

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
      <div className={css.box}>
        <button
          type="button"
          className={css.leading}
          aria-label={chatLabels.menuLabel}
          onClick={onOpenMenu}
        >
          <IconPlusOutlineMedium size={16} />
        </button>
        <textarea
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
            aria-label={chatLabels.sendLabel}
            data-ready={hasText}
            onClick={submit}
          >
            <IconSendOutlineRegular size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
