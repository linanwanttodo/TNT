/**
 * The left rail: the conversation list grouped by workspace and the
 * connection state.
 *
 * The desktop shell this was ported from also draws a Cowork/Code switch, a
 * New button and a navigation block here. The server has no route behind any
 * of them — sessions are listed, never created or switched over HTTP — so the
 * rail shows only what it can actually show.
 */
import type { SessionSummary } from "../../api/client.ts";
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
  /** Connection state, shown as a dot beside its label. */
  status?: "live" | "reconnecting" | "offline" | undefined;
}

/** Text the connection footer gives each state. */
const STATUS_LABEL: Record<NonNullable<SidebarProps["status"]>, string> = {
  live: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

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
 * @param props - the groups, the active session and the connection state.
 * @returns the sidebar element.
 */
export function Sidebar({
  groups,
  activeSessionId,
  status = "live",
}: SidebarProps) {
  return (
    <aside className={css.sidebar}>
      <div className={css.sessionList}>
        {groups.map((group) => (
          <section key={group.name} className={css.group}>
            <header className={css.groupHeader}>
              <span className={css.groupName}>{group.name}</span>
            </header>
            {group.sessions.map((session) => (
              <div
                key={session.sessionId}
                className={css.sessionRow}
                data-active={session.sessionId === activeSessionId}
              >
                <span className={css.sessionTitle}>{session.title}</span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className={css.account}>
        <span
          className={css.accountStatus}
          data-status={status}
          aria-hidden="true"
        />
        <span className={css.accountName}>{STATUS_LABEL[status]}</span>
      </div>
    </aside>
  );
}
