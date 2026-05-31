/** Question card: the engine asked; answer it inline, option or custom. */
import { useState } from "react";

import { Button, StateDot } from "../primitives/index.ts";
import css from "./ApprovalCard.module.css";
import cardCss from "./QuestionCard.module.css";

export function QuestionCard({
  pending,
  onAnswer,
}: {
  pending: {
    requestId: string;
    question: string;
    options?: string[];
    defaultAnswer?: string;
  };
  onAnswer: (answer: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const [answered, setAnswered] = useState<string | null>(null);

  const answer = (value: string) => {
    setAnswered(value);
    onAnswer(value);
  };

  return (
    <div
      className={css.card}
      data-request-id={pending.requestId}
      aria-busy={answered !== null}
    >
      <div className={css.strip}>
        <StateDot state="warning" />
        <span>The agent is asking</span>
      </div>
      <div className={css.body}>
        <div className={cardCss.question}>{pending.question}</div>
        {pending.options && pending.options.length > 0 ? (
          <div className={cardCss.options}>
            {pending.options.map((option) => (
              <Button
                key={option}
                variant={
                  option === pending.defaultAnswer ? "primary" : "outline"
                }
                disabled={answered !== null}
                onClick={() => answer(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        {pending.options && pending.options.length > 0 ? (
          <div className={cardCss.customRow}>
            <input
              className={cardCss.customInput}
              value={custom}
              placeholder="Or type your own answer..."
              disabled={answered !== null}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  custom.trim() !== "" &&
                  answered === null
                ) {
                  answer(custom.trim());
                }
              }}
            />
            <Button
              variant="outline"
              disabled={answered !== null || custom.trim() === ""}
              onClick={() => answer(custom.trim())}
            >
              Send
            </Button>
          </div>
        ) : null}
        {(!pending.options || pending.options.length === 0) &&
        answered === null ? (
          <div className={cardCss.customRow}>
            <input
              className={cardCss.customInput}
              value={custom}
              placeholder="Your answer..."
              autoFocus
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && custom.trim() !== "") {
                  answer(custom.trim());
                }
              }}
            />
            <Button
              variant="primary"
              disabled={custom.trim() === ""}
              onClick={() => answer(custom.trim())}
            >
              Send
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
