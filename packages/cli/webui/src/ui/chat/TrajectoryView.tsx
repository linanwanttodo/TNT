import { useSessionStore } from "../../stores/session-store.js";
import css from "./TrajectoryView.module.css";

export function TrajectoryView() {
  const items = useSessionStore((state) => state.items);
  const relevant = items.filter(
    (item) => item.kind === "tool" || item.kind === "reasoning",
  );
  if (relevant.length === 0) {
    return (
      <div className={css.frame}>
        <div className={css.muted}>No trajectory yet</div>
      </div>
    );
  }
  return (
    <div className={css.frame}>
      <div className={css.timeline}>
        {relevant.map((item, index) => {
          // Visual role, per ZCode's ModelTrajectoryRoleStyles: reasoning and
          // tool calls/results each carry their own hue.
          const role =
            item.kind === "reasoning"
              ? "reasoning"
              : item.status === "done"
                ? "tool-result"
                : "tool-call";
          return (
            <div className={css.entry} key={index}>
              <span
                className={css.dot}
                data-kind={item.kind === "tool" ? item.status : "thinking"}
                data-role={role}
              />
              <div className={css.body}>
                <div className={css.title} data-role={role}>
                  {item.kind === "tool" ? item.toolName : "Thinking"}
                </div>
                {item.kind === "reasoning" ? (
                  <div className={css.detail}>{item.text.slice(0, 160)}</div>
                ) : item.result ? (
                  <div className={css.detail}>{item.result.slice(0, 160)}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
