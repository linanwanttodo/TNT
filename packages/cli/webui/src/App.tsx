/**
 * App shell: sidebar over the conversation canvas, matching the Claude Code
 * Desktop layout the dsh-claude-style skin recreates. Task 9 fills the chat
 * view in; this file only carries the layout until then.
 */
import { useState } from "react";

import css from "./App.module.css";

export function App() {
  const [dark, setDark] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  document.documentElement.setAttribute(
    "data-theme",
    dark ? "dark" : "light",
  );

  return (
    <div className={css.shell}>
      <aside className={css.sidebar}>
        <div className={css.brand}>tnt</div>
        <button
          type="button"
          className={css.themeToggle}
          onClick={() => setDark((d) => !d)}
        >
          {dark ? "Light" : "Dark"}
        </button>
      </aside>
      <main className={css.canvas}>
        <div className={css.placeholder}>web ui</div>
      </main>
    </div>
  );
}
