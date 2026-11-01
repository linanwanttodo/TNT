/**
 * The bar across the top of the conversation canvas: the session title on the
 * left, the terminal and folder actions on the right, and the three window
 * controls the desktop shell draws at the far edge.
 */
import { ShellIcon } from "./icons.tsx";
import css from "./TitleBar.module.css";

/** Props the title bar renders from. */
export interface TitleBarProps {
  /** Title of the conversation on screen. */
  title: string;
}

/**
 * The conversation title bar.
 * @param props - the title to show.
 * @returns the title bar element.
 */
export function TitleBar({ title }: TitleBarProps) {
  return (
    <header className={css.titleBar}>
      <span className={css.title}>{title}</span>
      <div className={css.actions}>
        <button type="button" className={css.action} aria-label="Open terminal">
          <ShellIcon glyph="terminal" size={14} />
        </button>
        <button type="button" className={css.action} aria-label="Open folder">
          <ShellIcon glyph="folder" size={14} />
        </button>
      </div>
      <div className={css.windowControls}>
        <button
          type="button"
          className={css.windowControl}
          aria-label="Minimize"
        >
          <span className={css.minimize} />
        </button>
        <button
          type="button"
          className={css.windowControl}
          aria-label="Maximize"
        >
          <span className={css.maximize} />
        </button>
        <button type="button" className={css.windowControl} aria-label="Close">
          <span className={css.close} />
        </button>
      </div>
    </header>
  );
}
