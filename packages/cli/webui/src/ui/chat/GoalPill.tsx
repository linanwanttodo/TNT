import { useEffect, useRef, useState } from "react";
import { IconGoalOutlineRegular } from "../primitives/icons/index.tsx";
import css from "./GoalPill.module.css";

export interface Goal {
  text: string;
  startedAt: number;
  pausedAt?: number | undefined;
  accumulatedMs?: number | undefined;
}

function elapsed(goal: Goal, now: number): string {
  const base = goal.accumulatedMs ?? 0;
  const running = goal.pausedAt === undefined ? Math.max(0, now - goal.startedAt) : 0;
  const seconds = Math.floor((base + running) / 1000);
  return `${seconds}s`;
}

export function GoalPill({
  goal,
  onChange,
  onPause,
  onDelete,
}: {
  goal: Goal;
  onChange: (text: string) => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.text);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (goal.pausedAt !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal.pausedAt]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      onDelete();
      return;
    }
    onChange(text);
    setEditing(false);
  };

  const paused = goal.pausedAt !== undefined;

  return (
    <div className={css.pill} data-paused={paused}>
      <IconGoalOutlineRegular size={14} className={css.icon} />
      <span className={css.label}>Pursuing goal</span>
      {editing ? (
        <input
          ref={inputRef}
          className={css.editor}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(goal.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={css.text}
          onClick={() => {
            setDraft(goal.text);
            setEditing(true);
          }}
        >
          {goal.text}
        </button>
      )}
      <span className={css.time}>{elapsed(goal, now)}</span>
      <button type="button" className={css.action} onClick={onPause}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className={css.action} onClick={onDelete}>
        Done
      </button>
    </div>
  );
}
