/**
 * The strip under the conversation: where the run happens, which folder it
 * runs in, which worktree it is attached to, which permissions it holds and
 * which model answers.
 */
import { useEffect, useRef, useState } from "react";

import {
  PERMISSION_MODE_OPTIONS,
  setPermissionMode,
  type PermissionMode,
} from "../../api/client.js";
import { ShellIcon } from "./icons.tsx";
import css from "./StatusBar.module.css";

/** Props the status bar renders from. */
export interface StatusBarProps {
  /** Machine the session runs on. */
  host?: string | undefined;
  /** Workspace folder the session runs in. */
  workspace?: string | undefined;
  /** Whether the session is attached to a git worktree. */
  worktree?: boolean | undefined;
  /** Permission mode shown as a pill. */
  permissionMode?: string | undefined;
  /** Model answering. */
  model?: string | undefined;
  /** The routing group the model belongs to. */
  modelDetail?: string | undefined;
  /** Whether a turn is running now; the strip shows its spinner only then. */
  waiting?: boolean | undefined;
}

/** Label the pill shows for a mode; unknown modes render verbatim. */
function modeLabel(mode: string | undefined): string {
  const option = PERMISSION_MODE_OPTIONS.find((o) => o.mode === mode);
  return option ? option.label : (mode ?? "");
}

/**
 * The status strip.
 * @param props - the labels to show.
 * @returns the status bar element.
 */
export function StatusBar({
  host,
  workspace,
  worktree,
  permissionMode = "default",
  model,
  modelDetail,
  waiting = false,
}: StatusBarProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<PermissionMode | string | undefined>(
    permissionMode,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrent(permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (mode: PermissionMode) => {
    setOpen(false);
    const previous = current;
    setCurrent(mode);
    setPermissionMode(mode)
      .then((confirmed) => {
        if (confirmed) {
          setCurrent(confirmed);
        }
      })
      .catch(() => {
        // The session never adopted the mode; showing it would be a lie.
        setCurrent(previous);
      });
  };

  return (
    <footer className={css.statusBar}>
      {host || workspace || worktree ? (
        <span className={css.entries}>
          {host ? (
            <span className={css.entry}>
              <ShellIcon glyph="laptop" size={14} className={css.entryIcon} />
              <span>{host}</span>
            </span>
          ) : null}
          {workspace ? (
            <span className={css.entry}>
              <ShellIcon glyph="folder" size={14} className={css.entryIcon} />
              <span>{workspace}</span>
            </span>
          ) : null}
          {worktree ? (
            <span className={css.worktree}>
              <ShellIcon glyph="branch" size={12} />
              <span>Worktree</span>
            </span>
          ) : null}
        </span>
      ) : null}
      <span className={css.right}>
        <span className={css.modeAnchor} ref={menuRef}>
          {open ? (
            <div className={css.menu} role="menu">
              <div className={css.menuTitle}>Permissions · this session</div>
              {PERMISSION_MODE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  role="menuitem"
                  className={css.menuItem}
                  onClick={() => pick(option.mode)}
                >
                  <span className={css.menuItemTexts}>
                    <span className={css.menuItemLabel}>{option.label}</span>
                    <span className={css.menuItemDescription}>
                      {option.description}
                    </span>
                  </span>
                  {current === option.mode ? (
                    <span className={css.menuCheck} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={css.pill}
            onClick={() => setOpen((v) => !v)}
          >
            {modeLabel(current)}
          </button>
        </span>
        {model || modelDetail ? (
          <span className={css.model}>
            {model}
            {model && modelDetail ? " · " : ""}
            {modelDetail}
          </span>
        ) : null}
        {waiting ? (
          <span className={css.spinner} data-waiting="" aria-hidden="true" />
        ) : null}
      </span>
    </footer>
  );
}
