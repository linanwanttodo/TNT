/**
 * The left rail: the icon row, the Cowork/Code switch, the New button, the
 * navigation rows, the conversation list and the account row.
 *
 * The geometry is the one the Claude Code desktop shell draws, measured off a
 * 1x capture: a 200px rail, an 8px gutter, a 28px segmented switch and a
 * 30px conversation row.
 */
import {
  IconChevronDownOutlineRegular,
  IconEllipsisOutlineRegular,
  IconSearchOutlineRegular,
} from "../primitives/icons/index.tsx";

import type { SessionSummary } from "../../api/client.ts";
import { ShellIcon } from "./icons.tsx";
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
  /** Connection state, shown as a dot beside the account name. */
  status?: "live" | "reconnecting" | "offline" | undefined;
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
  status = "live",
}: SidebarProps) {
  return (
    <aside className={css.sidebar}>
      <div className={css.iconRow}>
        <ShellIcon glyph="menu" className={css.iconButton} />
        <ShellIcon glyph="panel-left" className={css.iconButton} />
        <ShellIcon glyph="arrow-left" className={css.iconButton} />
        <ShellIcon glyph="arrow-right" className={css.iconButton} />
      </div>

      <div className={css.segmented} role="tablist" aria-label="Workspace">
        <button
          type="button"
          role="tab"
          className={css.segment}
          aria-selected={false}
        >
          <ShellIcon glyph="cowork" size={12} />
          <span>Cowork</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`${css.segment} ${css.segmentActive}`}
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

      <nav className={css.nav}>
        <button type="button" className={css.navRow}>
          <ShellIcon glyph="clock" size={12} />
          <span>Routines</span>
        </button>
        <button type="button" className={css.navRow}>
          <ShellIcon glyph="toolbox" size={12} />
          <span>Customize</span>
        </button>
        <button type="button" className={css.navRow}>
          <ShellIcon glyph="dots" size={12} />
          <span>More</span>
        </button>
      </nav>

      <div className={css.sessionList}>
        {groups.map((group) => (
          <section key={group.name} className={css.group}>
            <header className={css.groupHeader}>
              <span className={css.groupName}>
                {group.name}
                <IconChevronDownOutlineRegular
                  size={14}
                  className={css.groupChevron}
                />
              </span>
              <button
                type="button"
                className={css.groupAdd}
                aria-label={`New session in ${group.name}`}
              >
                <ShellIcon glyph="plus" size={12} />
              </button>
            </header>
            {group.sessions.map((session) => (
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
                <IconEllipsisOutlineRegular
                  size={14}
                  className={css.sessionMenu}
                />
              </button>
            ))}
          </section>
        ))}
      </div>

      <div className={css.account}>
        <ShellIcon glyph="sunburst" size={16} className={css.accountMark} />
        <span className={css.accountName}>lin</span>
        <span className={css.accountSeparator}>·</span>
        <span className={css.accountGateway}>Gateway</span>
        <IconChevronDownOutlineRegular
          size={14}
          className={css.accountChevron}
        />
        <span className={css.accountStatus} data-status={status} />
        <IconSearchOutlineRegular size={14} className={css.accountSearch} />
      </div>
    </aside>
  );
}
