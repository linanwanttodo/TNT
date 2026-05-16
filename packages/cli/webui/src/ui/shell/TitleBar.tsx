/**
 * The bar across the top of the conversation canvas: the session title on
 * the left, and the conversation actions on the right - new session, and the
 * menu with the mode and session facts. A browser page has no window to
 * minimize or close, so unlike the desktop shell this bar carries no window
 * controls.
 */
import { useState } from "react";

import type {
  ContextBreakdown,
  GitStatus,
  PermissionMode,
} from "../../api/client.ts";
import {
  IconEllipsisOutlineRegular,
  IconPanelLeftOutlineRegular,
  IconPlusOutlineRegular,
} from "../primitives/icons/index.tsx";
import { ShellIcon } from "./icons.tsx";
import {
  ChatViewTabs,
  type ChatViewId,
} from "../chat/ChatViewTabs.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { StatusMenu } from "./StatusMenu.tsx";
import css from "./TitleBar.module.css";

/** Props the title bar renders from. */
export interface TitleBarProps {
  /** Title of the conversation on screen. */
  title: string;
  /** Return to the conversation from a full-page view. */
  onBack?: (() => void) | undefined;
  /** Mode the menu checks; undefined until /state lands. */
  permissionMode?: string | undefined;
  onSetPermissionMode?: ((mode: PermissionMode) => void) | undefined;
  onNewSession?: (() => void) | undefined;
  /** Facts the menu shows. */
  model?: string | undefined;
  workspaceDirectory?: string | undefined;
  /** Token budget shown by the top status button. */
  context?: ContextBreakdown | null | undefined;
  /** Repository facts shown by the top status button. */
  git?: GitStatus | null | undefined;
  /** Whether a turn is running. */
  isProcessing?: boolean | undefined;
  /** Messages waiting in the queue. */
  queueLength?: number | undefined;
  /** Whether a permission request is waiting. */
  hasPendingPermission?: boolean | undefined;
  /** Active main-canvas view. */
  view?: ChatViewId | undefined;
  /** Switch the main-canvas view. */
  onViewChange?: ((view: ChatViewId) => void) | undefined;
  /** Toggle the workspace rail. */
  onToggleRail?: (() => void) | undefined;
}

/**
 * The conversation title bar.
 * @param props - the title and the conversation actions.
 * @returns the title bar element.
 */
export function TitleBar({
  title,
  onBack,
  permissionMode,
  onSetPermissionMode,
  onNewSession,
  model,
  workspaceDirectory,
  context,
  git,
  isProcessing = false,
  queueLength = 0,
  hasPendingPermission = false,
  view = "chat",
  onViewChange,
  onToggleRail,
}: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={css.titleBar}>
      {onBack ? (
        <button
          type="button"
          className={css.backButton}
          aria-label="Back to chat"
          onClick={onBack}
        >
          <ShellIcon glyph="arrow-left" size={14} />
        </button>
      ) : null}
      <span className={css.title}>{title}</span>
      {onViewChange ? (
        <div className={css.viewTabs}>
          <ChatViewTabs active={view} onChange={onViewChange} />
        </div>
      ) : null}
      <div className={css.actions}>
        {onToggleRail ? (
          <button
            type="button"
            className={css.actionButton}
            aria-label="Toggle workspace rail"
            onClick={onToggleRail}
          >
            <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
              <IconPanelLeftOutlineRegular size={14} />
            </span>
          </button>
        ) : null}
        <StatusMenu
          title={title}
          model={model ?? ""}
          permissionMode={permissionMode}
          context={context ?? null}
          git={git ?? null}
          isProcessing={isProcessing}
          queueLength={queueLength}
          hasPendingPermission={hasPendingPermission}
        />
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
            showPermissionModes={false}
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
