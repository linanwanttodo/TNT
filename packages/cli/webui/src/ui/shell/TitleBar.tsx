/**
 * The bar across the top of the conversation canvas: the session title on
 * the left, and the conversation actions on the right - new session, and the
 * menu with the mode and session facts. A browser page has no window to
 * minimize or close, so unlike the desktop shell this bar carries no window
 * controls.
 */
import { useState } from "react";

import type { PermissionMode } from "../../api/client.ts";
import {
  IconEllipsisOutlineRegular,
  IconPlusOutlineRegular,
} from "../primitives/icons/index.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import css from "./TitleBar.module.css";

/** Props the title bar renders from. */
export interface TitleBarProps {
  /** Title of the conversation on screen. */
  title: string;
  /** Mode the menu checks; undefined until /state lands. */
  permissionMode?: string | undefined;
  onSetPermissionMode?: ((mode: PermissionMode) => void) | undefined;
  onNewSession?: (() => void) | undefined;
  /** Facts the menu shows. */
  model?: string | undefined;
  workspaceDirectory?: string | undefined;
}

/**
 * The conversation title bar.
 * @param props - the title and the conversation actions.
 * @returns the title bar element.
 */
export function TitleBar({
  title,
  permissionMode,
  onSetPermissionMode,
  onNewSession,
  model,
  workspaceDirectory,
}: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={css.titleBar}>
      <span className={css.title}>{title}</span>
      <div className={css.actions}>
        <button
          type="button"
          className={css.actionButton}
          aria-label="New session"
          onClick={onNewSession}
        >
          <IconPlusOutlineRegular size={14} />
        </button>
        <div className={css.menuAnchor}>
          <button
            type="button"
            className={css.actionButton}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconEllipsisOutlineRegular size={14} />
          </button>
          <SettingsMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            permissionMode={permissionMode}
            onSetPermissionMode={onSetPermissionMode}
            model={model ?? ""}
            workspaceDirectory={workspaceDirectory ?? null}
            className={css.menuAtTop}
          />
        </div>
      </div>
    </header>
  );
}
