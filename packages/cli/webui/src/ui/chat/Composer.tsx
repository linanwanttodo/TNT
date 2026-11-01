/** The composer: text area with a send button that becomes stop while waiting. */
import { useState, type KeyboardEvent } from "react";
import { Button, IconSendOutlineRegular, IconStopFillRegular } from "../primitives/index.ts";
import css from "./Composer.module.css";
import { chatLabels } from "./labels.js";

export function Composer({ waiting, onSend, onStop }: {
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={css.frame}>
      <div className={css.box}>
        <textarea
          className={css.input}
          value={text}
          rows={1}
          aria-label={chatLabels.inputAria}
          placeholder={chatLabels.inputPlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keydown}
        />
        {waiting
          ? (
              <Button
                variant="primary"
                size="sm"
                className={css.action}
                aria-label={chatLabels.stopLabel}
                onClick={onStop}
              >
                <IconStopFillRegular size={14} />
              </Button>
            )
          : (
              <Button
                variant="primary"
                size="sm"
                className={css.action}
                aria-label={chatLabels.sendLabel}
                disabled={text.trim() === ""}
                onClick={submit}
              >
                <IconSendOutlineRegular size={14} />
              </Button>
            )}
      </div>
    </div>
  );
}
