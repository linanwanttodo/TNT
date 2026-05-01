/**
 * The composer: a rounded input field with a leading plus button. The send
 * button appears once there is something to send; while a turn runs it
 * becomes a stop button.
 */
import { useState, type KeyboardEvent } from "react";
import {
  Button,
  IconSendOutlineRegular,
  IconStopFillRegular,
} from "../primitives/index.ts";
import { ShellIcon } from "../shell/icons.tsx";
import css from "./Composer.module.css";
import { chatLabels } from "./labels.js";

export function Composer({
  waiting,
  onSend,
  onStop,
}: {
  waiting: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
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
          aria-label={chatLabels.attachLabel}
        >
          <ShellIcon glyph="plus-compact" size={12} />
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
          <Button
            variant="primary"
            size="sm"
            className={css.action}
            aria-label={chatLabels.stopLabel}
            onClick={onStop}
          >
            <IconStopFillRegular size={14} />
          </Button>
        ) : hasText ? (
          <Button
            variant="primary"
            size="sm"
            className={css.action}
            aria-label={chatLabels.sendLabel}
            onClick={submit}
          >
            <IconSendOutlineRegular size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
