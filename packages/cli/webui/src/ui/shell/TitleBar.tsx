/** The bar across the top of the conversation canvas: the session title. */
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
    </header>
  );
}
