/**
 * App shell: the left rail beside the conversation canvas, drawn to the
 * Claude Code desktop layout. The session store is the single source of truth
 * for the conversation; SSE and POSTs go through the api client.
 */
import { useEffect, useMemo, useState } from "react";

import {
  connectEvents,
  deleteSession,
  fetchContextBreakdown,
  fetchGitStatus,
  fetchSessions,
  fetchState,
  renameSession,
  setPermissionMode,
  stopTurn,
  type ContextBreakdown,
  type GitStatus,
  type PermissionMode,
  type SessionSummary,
} from "./api/client.js";
import { useSessionStore } from "./stores/session-store.js";
import { ChatView } from "./ui/chat/ChatView.tsx";
import { ChatViewTabs, type ChatViewId } from "./ui/chat/ChatViewTabs.tsx";
import { ContextView } from "./ui/chat/ContextView.tsx";
import { SquadView } from "./ui/chat/SquadView.tsx";
import { TrajectoryView } from "./ui/chat/TrajectoryView.tsx";
import { Composer } from "./ui/chat/Composer.tsx";
import { ChangedFilesPill } from "./ui/chat/ChangedFilesPill.tsx";
import { chatLabels } from "./ui/chat/labels.js";
import { GoalPill, type Goal } from "./ui/chat/GoalPill.tsx";
import { SettingsPage } from "./ui/shell/settings/SettingsPage.tsx";
import { SettingsSidebar } from "./ui/shell/settings/SettingsSidebar.tsx";
import type { SettingsSectionId } from "./ui/shell/settings/types.ts";
import { EmptyState } from "./ui/shell/EmptyState.tsx";
import { SettingsMenu } from "./ui/shell/SettingsMenu.tsx";
import { Sidebar, groupSessions } from "./ui/shell/Sidebar.tsx";
import { StatusBar } from "./ui/shell/StatusBar.tsx";
import { TitleBar } from "./ui/shell/TitleBar.tsx";
import { WorkspaceRail } from "./ui/shell/WorkspaceRail.tsx";
import css from "./App.module.css";

/** Title a conversation has before the engine names it. */
const DEFAULT_TITLE = "New session";

/** The folder name a workspace path renders as in the status strip. */
function folderName(workspaceDirectory: string): string {
  const trimmed = workspaceDirectory.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).pop();
  return name && name !== "" ? name : workspaceDirectory;
}

function isSettingsHash(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.hash === "#settings" ||
      window.location.hash === "#customize")
  );
}

export function App() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const title = useSessionStore((s) => s.title);
  const chatModelTitle = useSessionStore((s) => s.chatModelTitle);
  const models = useSessionStore((s) => s.models);
  const currentModel = useSessionStore((s) => s.currentModel);
  const worktrees = useSessionStore((s) => s.worktrees);
  const currentWorktree = useSessionStore((s) => s.currentWorktree);
  const worktreeSwitchable = useSessionStore((s) => s.worktreeSwitchable);
  const worktreeChosen = useSessionStore((s) => s.worktreeChosen);
  const isProcessing = useSessionStore((s) => s.isProcessing);
  const queueLength = useSessionStore((s) => s.queueLength);
  const items = useSessionStore((s) => s.items);
  const streaming = useSessionStore((s) => s.streaming);
  const reasoning = useSessionStore((s) => s.reasoning);
  const isWaiting = useSessionStore((s) => s.isWaiting);
  const pendingChangedFiles = useSessionStore((s) => s.pendingChangedFiles);
  const pendingPermission = useSessionStore((s) => s.pendingPermission);
  const notices = useSessionStore((s) => s.notices);
  const status = useSessionStore((s) => s.status);

  const applyEvent = useSessionStore((s) => s.applyEvent);
  const approve = useSessionStore((s) => s.approve);
  const send = useSessionStore((s) => s.send);
  const setStatus = useSessionStore((s) => s.setStatus);
  const refreshModels = useSessionStore((s) => s.refreshModels);
  const pickModel = useSessionStore((s) => s.pickModel);
  const refreshWorktrees = useSessionStore((s) => s.refreshWorktrees);
  const pickWorktree = useSessionStore((s) => s.pickWorktree);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [permissionMode, setMode] = useState<string | undefined>();
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [context, setContext] = useState<ContextBreakdown | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [view, setView] = useState<ChatViewId>("chat");
  const [railOpen, setRailOpen] = useState(false);

  const hydrate = useSessionStore((s) => s.hydrate);

  // The model label the chips read: the /models list's current entry when it
  // is loaded, else the session's own report, else nothing.
  const modelLabel = currentModel?.name ?? chatModelTitle ?? "";

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
    if (status !== "reconnecting") return;
    void fetchState()
      .then((state) => {
        hydrate(state);
      })
      .catch(() => {});
  }, [status, hydrate]);

  // The status chips read two lists the /state snapshot does not carry, so
  // they are pulled on mount: the models the session may run on, and the
  // repository's checkouts (which says whether the page may move into one).
  useEffect(() => {
    void refreshModels();
    void refreshWorktrees();
  }, [refreshModels, refreshWorktrees]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchGitStatus()
        .then((next) => {
          if (!cancelled) setGit(next);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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

  const refreshSessions = () => {
    void fetchSessions()
      .then((next) => setSessions(next))
      .catch(() => {});
  };

  const [notice, setNotice] = useState<string | null>(null);

  // The context ring tracks the conversation: refresh when the session
  // changes, while a turn runs, and shortly after one lands.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchContextBreakdown()
        .then((next) => {
          if (!cancelled) setContext(next);
        })
        .catch(() => {});
    };
    load();
    if (!isProcessing)
      return () => {
        cancelled = true;
      };
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, isProcessing, items.length]);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const isEmpty = items.length === 0 && streaming === null && !isWaiting;

  const [settingsOpen, setSettingsOpen] = useState(isSettingsHash);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("plugins");
  const [draft, setDraft] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal | null>(() => {
    try {
      const raw = localStorage.getItem("tnt-webui-goal");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Goal;
      return parsed?.text ? parsed : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (goal === null) localStorage.removeItem("tnt-webui-goal");
    else localStorage.setItem("tnt-webui-goal", JSON.stringify(goal));
  }, [goal]);

  const pauseGoal = () => {
    setGoal((current) => {
      if (!current) return null;
      if (current.pausedAt !== undefined) {
        const pausedFor = Date.now() - current.pausedAt;
        return {
          ...current,
          startedAt: Date.now(),
          accumulatedMs: (current.accumulatedMs ?? 0) + pausedFor,
          pausedAt: undefined,
        };
      }
      return { ...current, pausedAt: Date.now() };
    });
  };

  useEffect(() => {
    const sync = () => setSettingsOpen(isSettingsHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        if (window.location.hash !== "#settings") {
          window.location.hash = "settings";
        }
        setSettingsOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openSettings = () => {
    if (window.location.hash !== "#settings") {
      window.location.hash = "settings";
    }
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    if (
      window.location.hash === "#settings" ||
      window.location.hash === "#customize"
    ) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  };

  const onNewSession = () => {
    closeSettings();
    void useSessionStore.getState().startNew();
  };
  const onSelectSession = (id: string) => {
    closeSettings();
    void useSessionStore.getState().switchTo(id);
  };
  const onRenameSession = (id: string, nextTitle: string) => {
    void renameSession(id, nextTitle)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      })
      .finally(() => void refreshSessions());
  };
  const onDeleteSession = (id: string) => {
    void deleteSession(id)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      })
      .finally(() => void refreshSessions());
  };
  const onOpenWorkspace = () => {
    const dir =
      sessions.find((s) => s.sessionId === sessionId)?.workspaceDirectory ??
      sessions[0]?.workspaceDirectory;
    if (dir) {
      void fetch(`/workspace/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir }),
      }).catch(() => {});
    }
  };
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
      {settingsOpen ? (
        <SettingsSidebar
          activeSection={settingsSection}
          onSelectSection={setSettingsSection}
          onBack={closeSettings}
        />
      ) : (
        <Sidebar
          groups={groups}
          status={status}
          activeSessionId={sessionId ?? undefined}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onNewSession={onNewSession}
          onSelectSession={onSelectSession}
          onOpenSettings={openSettings}
          settingsActive={false}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
        />
      )}
      <main className={css.canvas} data-collapsed={collapsed}>
        {settingsOpen ? null : (
          <TitleBar
            title={title ?? DEFAULT_TITLE}
            permissionMode={permissionMode}
            onSetPermissionMode={applyMode}
            onNewSession={onNewSession}
            model={modelLabel}
            workspaceDirectory={
              sessions.find((s) => s.sessionId === sessionId)
                ?.workspaceDirectory ?? sessions[0]?.workspaceDirectory
            }
            context={context}
            git={git}
            isProcessing={isProcessing}
            queueLength={queueLength}
            hasPendingPermission={pendingPermission !== null}
            view={view}
            onViewChange={setView}
            onToggleRail={() => setRailOpen((open) => !open)}
          />
        )}
        <div className={css.conversation}>
          {settingsOpen ? (
            <SettingsPage section={settingsSection} />
          ) : view === "context" ? (
            <ContextView context={context} />
          ) : view === "squad" ? (
            <SquadView />
          ) : view === "trajectory" ? (
            <TrajectoryView />
          ) : isEmpty ? (
            <EmptyState
              label={chatLabels.autoModeSuggestion}
              onPick={onPickSuggestion}
              workspace={folderName(
                sessions.find((s) => s.sessionId === sessionId)
                  ?.workspaceDirectory ??
                  sessions[0]?.workspaceDirectory ??
                  "",
              )}
              onSuggest={(prompt) => setDraft(prompt === "" ? null : prompt)}
            />
          ) : (
            <ChatView
              items={items}
              streaming={streaming}
              isStreaming={streaming !== null}
              reasoning={reasoning}
              pendingPermission={pendingPermission}
              notices={notices}
              onAnswer={(approved, remember) =>
                void approve(approved, remember)
              }
            />
          )}
        </div>
        {status !== "live" ? (
          <div className={css.banner} role="status">
            {chatLabels.disconnected}
          </div>
        ) : null}
        {settingsOpen ? null : (
          <div className={css.composerWrap}>
            {isProcessing && pendingChangedFiles.length > 0 ? (
              <ChangedFilesPill files={pendingChangedFiles} compact />
            ) : null}
            {goal ? (
              <GoalPill
                goal={goal}
                onChange={(text) => setGoal((current) => (current ? { ...current, text } : current))}
                onPause={pauseGoal}
                onDelete={() => setGoal(null)}
              />
            ) : null}
            <SettingsMenu
              open={composerMenuOpen}
              onClose={() => setComposerMenuOpen(false)}
              showPermissionModes={false}
              permissionMode={permissionMode}
              onSetPermissionMode={applyMode}
              model={modelLabel}
              workspaceDirectory={
                sessions.find((s) => s.sessionId === sessionId)
                  ?.workspaceDirectory ?? sessions[0]?.workspaceDirectory
              }
              onNewSession={onNewSession}
              className={css.menuAboveComposer}
            />
            <Composer
              waiting={isWaiting || isProcessing}
              idle={!isWaiting && !isProcessing && items.length > 0 && streaming === null}
              onSend={(text) => void send(text)}
              onStop={() => void stopTurn()}
              onOpenMenu={() => setComposerMenuOpen((open) => !open)}
              draft={draft}
              onDraftUsed={() => setDraft(null)}
            />
          </div>
        )}
        {settingsOpen ? null : (
          <StatusBar
            workspace={folderName(
              sessions.find((s) => s.sessionId === sessionId)
                ?.workspaceDirectory ??
                sessions[0]?.workspaceDirectory ??
                "",
            )}
            models={models}
            currentModel={currentModel}
            onPickModel={(index) => void pickModel(index)}
            worktrees={worktrees}
            currentWorktree={currentWorktree}
            worktreeSwitchable={worktreeSwitchable}
            worktreeChosen={worktreeChosen}
            onPickWorktree={(path) => void pickWorktree(path)}
            permissionMode={permissionMode}
            isProcessing={isProcessing}
            contextBreakdown={context}
            workspaceDirectory={
              sessions.find((s) => s.sessionId === sessionId)
                ?.workspaceDirectory ?? sessions[0]?.workspaceDirectory
            }
            onOpenWorkspace={onOpenWorkspace}
          />
        )}
      </main>
      {settingsOpen || !railOpen ? null : <WorkspaceRail />}
    </div>
  );
}
