/**
 * The left rail: app header, primary navigation, project folders, recent
 * sessions and the account row.
 *
 * A project folder is the whole click target: there is no separate chevron.
 * Clicking the folder row unfolds its conversations; clicking it again folds
 * them back. Sessions are grouped by their full workspace path, so two
 * folders that happen to share a name stay distinct.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconChevronDownOutlineRegular,
  IconNewChatOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
} from "../primitives/icons/index.tsx";

import { useUiPreferences } from "../../stores/ui-preferences.js";
import type { SessionSummary } from "../../api/client.ts";
import { AccountMenu } from "./AccountMenu.tsx";
import { ShellIcon } from "./icons.tsx";
import { shellCopy } from "./ui-copy.ts";
import css from "./Sidebar.module.css";

/** One group of conversations in the sidebar list. */
export interface SessionGroup {
  /** Full workspace path; the stable identity of the folder. */
  path: string;
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
  /** Collapse or expand the rail. */
  collapsed?: boolean | undefined;
  onToggleCollapsed?: (() => void) | undefined;
  /** Open the Settings view. */
  onOpenSettings?: (() => void) | undefined;
  /** True while the Settings view is the active page. */
  settingsActive?: boolean | undefined;
  /** Rename a conversation; the caller refreshes the list. */
  onRenameSession?: ((sessionId: string, title: string) => void) | undefined;
  /** Delete a conversation; the caller refreshes the list. */
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  /** Connection state, shown as a dot beside the account name. */
  status?: "live" | "reconnecting" | "offline" | undefined;
}

/** Unix time for a session, using its update time first. */
function sessionTime(session: SessionSummary): number {
  return Date.parse(session.updatedAt ?? session.dateCreated) || 0;
}

/** A compact relative timestamp for a Recents row. */
function relativeTime(timestamp: number, language: string): string {
  if (timestamp === 0) return "";
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

/**
 * Group conversations by the workspace they belong to.
 * @param sessions - the conversations to group.
 * @returns the groups, newest workspace first, sessions newest first.
 */
export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const path = session.workspaceDirectory;
    const group = groups.get(path);
    if (group) {
      group.sessions.push(session);
      continue;
    }
    groups.set(path, {
      path,
      name: workspaceName(path),
      sessions: [session],
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort(
        (left, right) => sessionTime(right) - sessionTime(left),
      ),
    }))
    .sort(
      (left, right) =>
        sessionTime(right.sessions[0]!) - sessionTime(left.sessions[0]!),
    );
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
  onOpenSettings,
  settingsActive = false,
  onRenameSession,
  onDeleteSession,
  status = "live",
}: SidebarProps) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const [menuOpen, setMenuOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((t) => t + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [editing, setEditing] = useState<
    { sessionId: string; initial: string } | undefined
  >(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (rowMenu === null) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-session-row-menu]")
      ) {
        return;
      }
      setRowMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRowMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);

  const toggleFold = (path: string) => {
    setFolded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const visibleSessions = (group: SessionGroup): SessionSummary[] => {
    const count = visibleCounts[group.path] ?? 5;
    return group.sessions.slice(0, count);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (session: SessionSummary): boolean =>
    normalizedQuery === "" ||
    session.title.toLowerCase().includes(normalizedQuery) ||
    session.workspaceDirectory.toLowerCase().includes(normalizedQuery);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          sessions: group.sessions.filter(matches),
        }))
        .filter((group) => normalizedQuery === "" || group.sessions.length > 0),
    [groups, normalizedQuery],
  );

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setQuery("");
      return !open;
    });
  };

  const renderSessionRow = (
    session: SessionSummary,
    variant: "project" | "recent",
  ) => {
    const isActive = session.sessionId === activeSessionId;
    const menu = rowMenu === session.sessionId;
    return (
      <div
        key={session.sessionId}
        className={css.sessionRowWrap}
        data-variant={variant}
      >
        {menu ? (
          <div
            className={css.sessionMenu}
            role="menu"
            data-session-row-menu="true"
          >
            <button
              type="button"
              role="menuitem"
              className={css.sessionMenuItem}
              onClick={() => {
                setRowMenu(null);
                setEditing({
                  sessionId: session.sessionId,
                  initial: session.title,
                });
              }}
            >
              {copy.rename}
            </button>
            <div className={css.sessionMenuSeparator} />
            <button
              type="button"
              role="menuitem"
              className={`${css.sessionMenuItem} ${css.sessionMenuDanger}`}
              disabled={isActive}
              title={isActive ? "Switch to another session first" : undefined}
              onClick={() => {
                setRowMenu(null);
                onDeleteSession?.(session.sessionId);
              }}
            >
              {copy.delete}
            </button>
          </div>
        ) : null}
        {editing?.sessionId === session.sessionId ? (
          <input
            type="text"
            className={css.sessionRename}
            defaultValue={session.title}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => setEditing(undefined)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const title = event.currentTarget.value.trim();
                setEditing(undefined);
                if (title && title !== session.title) {
                  onRenameSession?.(session.sessionId, title);
                }
              }
              if (event.key === "Escape") setEditing(undefined);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className={css.sessionRow}
              data-active={isActive}
              onClick={() => onSelectSession?.(session.sessionId)}
            >
              <span className={css.sessionTitle}>{session.title}</span>
              {variant === "recent" ? (
                <span className={css.sessionTime}>
                  {timeTick >= 0 ? relativeTime(sessionTime(session), language) : ""}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={css.sessionRowMenu}
              aria-label={`Actions for ${session.title}`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={(event) => {
                event.stopPropagation();
                setRowMenu(menu ? null : session.sessionId);
              }}
            >
              <ShellIcon glyph="dots" size={12} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <aside className={css.sidebar} data-collapsed={collapsed}>
      <div className={css.topBar}>
        <div className={css.appTitle}>
          <img src="/tnt-logo.svg" alt="" className={css.appMark} />
          <span className={css.appName}>TNT</span>
        </div>
        <div className={css.topActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={searchOpen ? "Close search" : "Search sessions"}
            aria-pressed={searchOpen}
            onClick={toggleSearch}
          >
            <IconSearchOutlineRegular size={16} />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapsed}
          >
            <ShellIcon glyph="panel-left" />
          </button>
        </div>
      </div>

      {searchOpen && !collapsed ? (
        <div className={css.searchBar}>
          <IconSearchOutlineRegular size={14} className={css.searchIcon} />
          <input
            ref={searchRef}
            type="search"
            className={css.searchInput}
            value={query}
            placeholder={copy.searchSessions}
            aria-label={copy.searchSessions}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <nav className={css.primaryNav} aria-label="Primary">
        <button type="button" className={css.navRow} onClick={onNewSession}>
          <IconNewChatOutlineRegular size={16} />
          <span>{copy.newChat}</span>
        </button>
        <button
          type="button"
          className={css.navRow}
          data-active={settingsActive}
          onClick={onOpenSettings}
        >
          <IconSettingsOutlineRegular size={16} />
          <span>{copy.settings}</span>
        </button>
      </nav>

      <div className={css.scrollArea}>
        <div className={css.sectionHeader}>{copy.projects}</div>
        {visibleGroups.length === 0 ? (
          <div className={css.noChats}>
            {normalizedQuery === "" ? copy.noChats : copy.noMatchingProjects}
          </div>
        ) : (
          visibleGroups.map((group) => {
            const isFolded = folded.has(group.path);
            const hasActive = group.sessions.some(
              (session) => session.sessionId === activeSessionId,
            );
            return (
              <section
                key={group.path}
                className={css.project}
                data-active={hasActive}
                data-expanded={!isFolded}
              >
                <button
                  type="button"
                  className={css.projectRow}
                  aria-expanded={!isFolded}
                  title={group.path}
                  onClick={() => toggleFold(group.path)}
                >
                  <ShellIcon
                    glyph="folder"
                    size={14}
                    className={css.projectFolder}
                  />
                  <span className={css.projectName}>{group.name}</span>
                </button>
                {isFolded ? null : (
                  <div className={css.projectChats}>
                    {group.sessions.length === 0 ? (
                      <div className={css.noChats}>{copy.noChats}</div>
                    ) : (
                      visibleSessions(group).map((session) =>
                        renderSessionRow(session, "project"),
                      )
                    )}
                  </div>
                )}
                {!isFolded &&
                group.sessions.length > (visibleCounts[group.path] ?? 5) ? (
                  <button
                    type="button"
                    className={css.projectRow}
                    data-variant="more"
                    onClick={() =>
                      setVisibleCounts((previous) => ({
                        ...previous,
                        [group.path]: (previous[group.path] ?? 5) + 5,
                      }))
                    }
                  >
                    {copy.showMore}
                  </button>
                ) : null}
              </section>
            );
          })
        )}

      </div>

      <div className={css.accountWrap}>
        <AccountMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onOpenSettings={() => onOpenSettings?.()}
        />
        <button
          type="button"
          className={css.account}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconSettingsOutlineRegular size={16} className={css.accountMark} />
          <span className={css.accountName}>TNT</span>
          <span className={css.accountStatus} data-status={status} />
          <IconChevronDownOutlineRegular
            size={14}
            className={css.accountChevron}
          />
        </button>
      </div>
    </aside>
  );
}
