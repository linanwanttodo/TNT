/**
 * App shell: sidebar over the conversation canvas, matching the Claude Code
 * Desktop layout the dsh-claude-style skin recreates. The session store is
 * the single source of truth; SSE and POSTs go through the api client.
 */
import { useEffect, useRef } from "react";

import {
  approve as postApproval,
  connectEvents,
  fetchState,
  stopTurn,
} from "./api/client.js";
import { useSessionStore } from "./stores/session-store.js";
import { ChatView } from "./ui/chat/ChatView.tsx";
import { Composer } from "./ui/chat/Composer.tsx";
import css from "./App.module.css";
import { chatLabels } from "./ui/chat/labels.js";

export function App() {
  const items = useSessionStore((s) => s.items);
  const streaming = useSessionStore((s) => s.streaming);
  const reasoning = useSessionStore((s) => s.reasoning);
  const isWaiting = useSessionStore((s) => s.isWaiting);
  const pendingPermission = useSessionStore((s) => s.pendingPermission);
  const notices = useSessionStore((s) => s.notices);
  const status = useSessionStore((s) => s.status);

  const applyEvent = useSessionStore((s) => s.applyEvent);
  const send = useSessionStore((s) => s.send);
  const approve = useSessionStore((s) => s.approve);
  const setStatus = useSessionStore((s) => s.setStatus);

  const connected = useRef(false);
  useEffect(() => {
    if (connected.current) return;
    connected.current = true;
    const close = connectEvents(applyEvent, setStatus);
    void fetchState().catch(() => {});
    return close;
  }, [applyEvent, setStatus]);

  return (
    <div className={css.shell}>
      <aside className={css.sidebar}>
        <div className={css.brand}>tnt</div>
        <div className={css.sidebarFooter}>
          <span className={css.status} data-status={status}>
            {status}
          </span>
        </div>
      </aside>
      <main className={css.canvas}>
        {status !== "live" && (
          <div className={css.banner} role="status">{chatLabels.disconnected}</div>
        )}
        <ChatView
          items={items}
          streaming={streaming}
          reasoning={reasoning}
          pendingPermission={pendingPermission}
          notices={notices}
          onAnswer={(approved) => void approve(approved)}
        />
        <Composer
          waiting={isWaiting}
          onSend={(text) => void send(text)}
          onStop={() => void stopTurn()}
        />
      </main>
    </div>
  );
}
