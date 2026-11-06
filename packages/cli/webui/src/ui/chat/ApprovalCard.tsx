/** Approval card: a pending permission with allow/reject actions. */
import { Button, StateDot } from "../primitives/index.ts";
import css from "./ApprovalCard.module.css";
import { chatLabels } from "./labels.js";

export function ApprovalCard({
  pending,
  onAnswer,
}: {
  pending: { requestId: string; toolName: string; toolArgs: unknown };
  onAnswer: (approved: boolean, remember?: boolean) => void;
}) {
  const detail = summarizeArgs(pending.toolArgs);
  return (
    <div
      className={css.card}
      data-request-id={pending.requestId}
      aria-busy="false"
    >
      <div className={css.strip}>
        <StateDot state="warning" />
        <span>{chatLabels.waiting}</span>
      </div>
      <div className={css.body}>
        <div className={css.headline}>{pending.toolName}</div>
        {detail !== "" && <div className={css.command}>{detail}</div>}
      </div>
      <div className={css.actionRow}>
        <Button
          variant="outline"
          className={css.reject}
          onClick={() => onAnswer(false)}
        >
          {chatLabels.reject}
        </Button>
        <Button variant="outline" onClick={() => onAnswer(true, true)}>
          {chatLabels.allowAlways}
        </Button>
        <Button variant="primary" onClick={() => onAnswer(true)}>
          {chatLabels.allow}
        </Button>
      </div>
    </div>
  );
}

function summarizeArgs(args: unknown): string {
  if (typeof args === "string") return args;
  if (args === undefined || args === null) return "";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
