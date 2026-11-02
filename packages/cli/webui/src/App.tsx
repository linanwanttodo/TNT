/**
 * App shell: the left rail beside the conversation canvas, drawn to the
 * Claude Code desktop layout. The session store is the single source of truth
 * for the conversation; SSE and POSTs go through the api client.
 */
import { useEffect, useMemo, useState } from "react";

import {
  connectEvents,
  fetchSessions,
  fetchState,
  setPermissionMode,
  stopTurn,
  type PermissionMode,
  type SessionSummary,
} from "./api/client.js";
import { useSessionStore } from "./stores/session-store.js";
import { ChatView } from "./ui/chat/ChatView.tsx";
import { Composer } from "./ui/chat/Composer.tsx";
import { chatLabels } from "./ui/chat/labels.js";
import { EmptyState } from "./ui/shell/EmptyState.tsx";
import { SettingsMenu } from "./ui/shell/SettingsMenu.tsx";
import { Sidebar, groupSessions } from "./ui/shell/Sidebar.tsx";
import { StatusBar } from "./ui/shell/StatusBar.tsx";
import { TitleBar } from "./ui/shell/TitleBar.tsx";
import css from "./App.module.css";

/** Title a conversation has before the engine names it. */
const DEFAULT_TITLE = "New session";

/** Model shown before the session reports one. */
const DEFAULT_MODEL = "Deepseek-V4.1-Flash";

export function App() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const title = useSessionStore((s) => s.title);
  const chatModelTitle = useSessionStore((s) => s.chatModelTitle);
  const items = useSessionStore((s) => s.items);
  const streaming = useSessionStore((s) => s.streaming);
  const reasoning = useSessionStore((s) => s.reasoning);
  const isWaiting = useSessionStore((s) => s.isWaiting);
  const pendingPermission = useSessionStore((s) => s.pendingPermission);
  const notices = useSessionStore((s) => s.notices);
  const status = useSessionStore((s) => s.status);

  const applyEvent = useSessionStore((s) => s.applyEvent);
  const approve = useSessionStore((s) => s.approve);
  const send = useSessionStore((s) => s.send);
  const setStatus = useSessionStore((s) => s.setStatus);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [permissionMode, setMode] = useState<string | undefined>();
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);

  const hydrate = useSessionStore((s) => s.hydrate);

  // StrictMode mounts effects twice: the ref guard alone would leave the
  // second mount without a stream, so the effect returns its cleanup and
  // re-connects on the second run.
  useEffect(() => {
    const close = connectEvents(applyEvent, setStatus);
    void fetchState()
      .then((state) => {
        hydrate(state);
        const mode = (state as { permissionMode?: unknown }).permissionMode;
        if (typeof mode === "string" && mode !== "") {
          setMode(mode);
        }
      })
      .catch(() => {});
    return close;
  }, [applyEvent, hydrate, setStatus]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchSessions()
        .then((next) => {
          if (!cancelled) setSessions(next);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const isEmpty = items.length === 0 && streaming === null && !isWaiting;

  const onNewSession = () => void useSessionStore.getState().startNew();
  const onSelectSession = (id: string) =>
    void useSessionStore.getState().switchTo(id);
  const onPickSuggestion = () => {
    setMode("auto");
    void setPermissionMode("auto")
      .then((next) => setMode(next))
      .catch(() => setMode(permissionMode));
  };

  const applyMode = (mode: PermissionMode) => {
    setMode(mode);
    void setPermissionMode(mode)
      .then((next) => setMode(next))
      .catch(() => setMode(permissionMode));
  };

  return (
    <div className={css.shell}>
      <Sidebar
        groups={groups}
        status={status}
        activeSessionId={sessionId ?? undefined}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onNewSession={onNewSession}
        onSelectSession={onSelectSession}
        permissionMode={permissionMode}
        onSetPermissionMode={applyMode}
        model={chatModelTitle ?? DEFAULT_MODEL}
        workspaceDirectory={
          sessions.find((s) => s.sessionId === sessionId)?.workspaceDirectory ??
          sessions[0]?.workspaceDirectory
        }
      />
      <main className={css.canvas} data-collapsed={collapsed}>
        <TitleBar
          title={title ?? DEFAULT_TITLE}
          permissionMode={permissionMode}
          onSetPermissionMode={applyMode}
          onNewSession={onNewSession}
          model={chatModelTitle ?? DEFAULT_MODEL}
          workspaceDirectory={
            sessions.find((s) => s.sessionId === sessionId)
              ?.workspaceDirectory ?? sessions[0]?.workspaceDirectory
          }
        />
        <div className={css.conversation}>
          {isEmpty ? (
            <EmptyState
              label={chatLabels.autoModeSuggestion}
              onPick={onPickSuggestion}
            />
          ) : (
            <ChatView
              items={items}
              streaming={streaming}
              reasoning={reasoning}
              pendingPermission={pendingPermission}
              notices={notices}
              onAnswer={(approved) => void approve(approved)}
            />
          )}
        </div>
        {status !== "live" ? (
          <div className={css.banner} role="status">
            {chatLabels.disconnected}
          </div>
        ) : null}
        <div className={css.composerWrap}>
          <SettingsMenu
            open={composerMenuOpen}
            onClose={() => setComposerMenuOpen(false)}
            permissionMode={permissionMode}
            onSetPermissionMode={applyMode}
            model={chatModelTitle ?? DEFAULT_MODEL}
            workspaceDirectory={
              sessions.find((s) => s.sessionId === sessionId)
                ?.workspaceDirectory ?? sessions[0]?.workspaceDirectory
            }
            onNewSession={onNewSession}
            className={css.menuAboveComposer}
          />
          <Composer
            waiting={isWaiting}
            onSend={(text) => void send(text)}
            onStop={() => void stopTurn()}
            onOpenMenu={() => setComposerMenuOpen((open) => !open)}
          />
        </div>
        <StatusBar
          model={chatModelTitle ?? DEFAULT_MODEL}
          permissionMode={permissionMode}
        />
      </main>
    </div>
  );
}
