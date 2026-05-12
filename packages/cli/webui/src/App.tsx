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
  stopTurn,
  type SessionSummary,
} from "./api/client.js";
import { useSessionStore } from "./stores/session-store.js";
import { ChatView } from "./ui/chat/ChatView.tsx";
import { Composer } from "./ui/chat/Composer.tsx";
import { chatLabels } from "./ui/chat/labels.js";
import { EmptyState } from "./ui/shell/EmptyState.tsx";
import { Sidebar, groupSessions } from "./ui/shell/Sidebar.tsx";
import { StatusBar } from "./ui/shell/StatusBar.tsx";
import { TitleBar } from "./ui/shell/TitleBar.tsx";
import css from "./App.module.css";

/** Title a conversation has before the engine names it. */
const DEFAULT_TITLE = "New session";

export function App() {
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
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [workspace, setWorkspace] = useState<string | undefined>();
  const [permissionMode, setPermissionMode] = useState<string | undefined>();

  const hydrate = useSessionStore((s) => s.hydrate);

  // StrictMode mounts effects twice: the ref guard alone would leave the
  // second mount without a stream, so the effect returns its cleanup and
  // re-connects on the second run.
  useEffect(() => {
    const close = connectEvents(applyEvent, setStatus);
    void fetchState()
      .then((state) => {
        hydrate(state);
        const session = state.session;
        if (!session) return;
        setSessionId(session.sessionId);
        if (typeof session.title === "string" && session.title !== "") {
          setTitle(session.title);
        }
        const chatModel = session.chatModelTitle;
        if (typeof chatModel === "string" && chatModel !== "") {
          setModel(chatModel);
        }
        const directory = session.workspaceDirectory;
        if (typeof directory === "string" && directory !== "") {
          setWorkspace(
            directory
              .replace(/[/\\]+$/, "")
              .split(/[/\\]/)
              .pop(),
          );
        }
        const mode = (state as { permissionMode?: unknown }).permissionMode;
        if (typeof mode === "string" && mode !== "") {
          setPermissionMode(mode);
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

  return (
    <div className={css.shell}>
      <Sidebar groups={groups} activeSessionId={sessionId} status={status} />
      <main className={css.canvas}>
        <TitleBar title={title} />
        <div className={css.conversation}>
          {isEmpty ? (
            <EmptyState label={chatLabels.autoModeSuggestion} />
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
        <Composer
          waiting={isWaiting}
          onSend={(text) => void send(text)}
          onStop={() => void stopTurn()}
        />
        <StatusBar
          workspace={workspace}
          model={model}
          permissionMode={permissionMode}
          waiting={isWaiting}
        />
      </main>
    </div>
  );
}
