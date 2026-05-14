/**
 * The left rail: the panel toggle, the Code view label, the New button, the
 * conversation list and the account row.
 *
 * The geometry is the one the Claude Code desktop shell draws, measured off a
 * 1x capture: a 200px rail, an 8px gutter, a 28px segmented switch and a
 * 30px conversation row.
 *
 * Everything rendered here is wired: the toggle collapses the rail, New and
 * the group plus start conversations, a row selects its session, a group
 * header folds its list, and the account row opens the settings menu.
 * Controls the v1 engine does not back (Cowork, Routines, Customize, More,
 * the back and forward arrows) are left out rather than drawn dead.
 */
import { useState } from "react";
import { IconChevronDownOutlineRegular } from "../primitives/icons/index.tsx";

import type { PermissionMode, SessionSummary } from "../../api/client.ts";
import { ShellIcon } from "./icons.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import css from "./Sidebar.module.css";

/** One group of conversations in the sidebar list. */
export interface SessionGroup {
  /** Group label: the workspace directory's own name. */
  name: string;
  sessions: SessionSummary[];
}

/** Props the sidebar renders from. */
export interface SidebarProps {
  groups: SessionGroup[];
  /** Session whose row is drawn as selected. */
  activeSessionId?: string | undefined;
  onSelectSession?: ((sessionId: string) => void) | undefined;
  onNewSession?: (() => void) | undefined;
  /** Collapse or expand the rail; the panel toggle drives it. */
  collapsed?: boolean | undefined;
  onToggleCollapsed?: (() => void) | undefined;
  /** Connection state, shown as a dot beside the account name. */
  status?: "live" | "reconnecting" | "offline" | undefined;
  /** Mode the settings menu checks; undefined until /state lands. */
  permissionMode?: string | undefined;
  onSetPermissionMode?: ((mode: PermissionMode) => void) | undefined;
  /** Facts the settings menu shows. */
  model?: string | undefined;
  workspaceDirectory?: string | undefined;
}

/**
 * Group conversations by the workspace they belong to.
 *
 * The shell lists a directory's conversations under that directory's name, so
 * the sidebar reads the way the filesystem does.
 * @param sessions - the conversations to group.
 * @returns the groups, in the order the workspaces first appear.
 */
export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const name = workspaceName(session.workspaceDirectory);
    const group = groups.get(name);
    if (group) {
      group.sessions.push(session);
      continue;
    }
    groups.set(name, { name, sessions: [session] });
  }
  return [...groups.values()];
}

/**
 * The last path segment of a workspace directory.
 * @param directory - the workspace path.
 * @returns its directory name, or the path itself when it has no segment.
 */
function workspaceName(directory: string): string {
  const trimmed = directory.replace(/[/\\]+$/, "");
  const segment = trimmed.split(/[/\\]/).pop();
  return segment && segment.length > 0 ? segment : trimmed;
}

/**
 * The left rail of the shell.
 * @param props - the groups, the active session and the row handlers.
 * @returns the sidebar element.
 */
export function Sidebar({
  groups,
  activeSessionId,
  onSelectSession,
  onNewSession,
  collapsed = false,
  onToggleCollapsed,
  status = "live",
  permissionMode,
  onSetPermissionMode,
  model,
  workspaceDirectory,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  const toggleFold = (name: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <aside className={css.sidebar} data-collapsed={collapsed}>
      <div className={css.iconRow}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          <ShellIcon glyph="panel-left" />
        </button>
      </div>

      <div className={css.segmented} role="tablist" aria-label="Workspace">
        <button
          type="button"
          role="tab"
          className={css.segment}
          aria-selected={true}
        >
          <ShellIcon glyph="code-brackets" size={12} />
          <span>Code</span>
        </button>
      </div>

      <button type="button" className={css.newButton} onClick={onNewSession}>
        <ShellIcon glyph="plus" size={12} />
        <span>New</span>
      </button>

      <div className={css.sessionList}>
        {groups.map((group) => {
          const isFolded = folded.has(group.name);
          return (
            <section key={group.name} className={css.group}>
              <header className={css.groupHeader}>
                <button
                  type="button"
                  className={css.groupNameButton}
                  aria-expanded={!isFolded}
                  onClick={() => toggleFold(group.name)}
                >
                  <IconChevronDownOutlineRegular
                    size={14}
                    className={css.groupChevron}
                    data-folded={isFolded}
                  />
                  <span className={css.groupName}>{group.name}</span>
                </button>
                <button
                  type="button"
                  className={css.groupAdd}
                  aria-label={`New session in ${group.name}`}
                  onClick={onNewSession}
                >
                  <ShellIcon glyph="plus" size={12} />
                </button>
              </header>
              {isFolded
                ? null
                : group.sessions.map((session) => (
                    <button
                      type="button"
                      key={session.sessionId}
                      className={css.sessionRow}
                      data-active={session.sessionId === activeSessionId}
                      onClick={() => onSelectSession?.(session.sessionId)}
                    >
                      <span className={css.sessionTitle}>{session.title}</span>
                      <ShellIcon
                        glyph="branch"
                        size={12}
                        className={css.sessionBadge}
                      />
                    </button>
                  ))}
            </section>
          );
        })}
      </div>

      <div className={css.accountWrap}>
        {menuOpen ? (
          <SettingsMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            permissionMode={permissionMode}
            onSetPermissionMode={onSetPermissionMode}
            model={model ?? ""}
            workspaceDirectory={workspaceDirectory ?? null}
          />
        ) : null}
        <button
          type="button"
          className={css.account}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ShellIcon glyph="sunburst" size={16} className={css.accountMark} />
          <span className={css.accountName}>lin</span>
          <span className={css.accountSeparator}>·</span>
          <span className={css.accountGateway}>Gateway</span>
          <IconChevronDownOutlineRegular
            size={14}
            className={css.accountChevron}
          />
          <span className={css.accountStatus} data-status={status} />
        </button>
      </div>
    </aside>
  );
}
