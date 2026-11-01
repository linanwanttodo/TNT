/**
 * What the canvas shows before a conversation starts: a single suggestion
 * pill, with the mascot sitting on its top edge.
 */
import { ShellIcon } from "./icons.tsx";
import css from "./EmptyState.module.css";

/** Props the empty state renders from. */
export interface EmptyStateProps {
  /** Label of the suggestion pill. */
  label: string;
  /** Called when the suggestion is picked. */
  onPick?: (() => void) | undefined;
}

/**
 * The empty-state suggestion.
 * @param props - the label and the handler.
 * @returns the empty state element.
 */
export function EmptyState({ label, onPick }: EmptyStateProps) {
  return (
    <div className={css.emptyState}>
      <div className={css.pill}>
        <ShellIcon glyph="lightning" size={12} className={css.pillIcon} />
        <button type="button" className={css.pillLabel} onClick={onPick}>
          {label}
        </button>
        <ShellIcon glyph="robot" size={35} className={css.mascot} />
      </div>
    </div>
  );
}
