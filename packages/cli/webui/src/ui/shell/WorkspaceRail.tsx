import { answerApproval } from "../../api/client.js";
import { useSessionStore } from "../../stores/session-store.js";
import { useSidePaneStore } from "../../stores/side-pane-store.js";
import type { SidePaneTab } from "../../stores/side-pane-store.js";
import { useUiPreferences } from "../../stores/ui-preferences.js";
import { ShellIcon } from "./icons.tsx";
import { shellCopy } from "./ui-copy.js";
import { ApprovalsPanel } from "./workspace-rail/ApprovalsPanel.tsx";
import { AutomationsPane } from "./workspace-rail/AutomationsPane.tsx";
import { DiffPane } from "./workspace-rail/DiffPane.tsx";
import { FilePreviewPane } from "./workspace-rail/FilePreviewPane.tsx";
import { FileTreePanel } from "./workspace-rail/FileTreePanel.tsx";
import { GitPanel } from "./workspace-rail/GitPanel.tsx";
import { SidePaneTabStrip, TabIcon } from "./workspace-rail/SidePaneTabs.tsx";
import { SubagentDirectoryPane } from "./workspace-rail/SubagentDirectoryPane.tsx";
import { SubagentPane } from "./workspace-rail/SubagentPane.tsx";
import { SubagentsPanel } from "./workspace-rail/SubagentsPanel.tsx";
import { TeamPane } from "./workspace-rail/TeamPane.tsx";
import { TerminalPanel } from "./workspace-rail/TerminalPanel.tsx";
import { useWorkspaceRailData } from "./workspace-rail/useWorkspaceRailData.js";
import css from "./WorkspaceRail.module.css";

/**
 * The right-hand side pane, ported from ZCode's app-shell side pane. There
 * are no fixed panels: every view is a tab that appears when something opens
 * it - a file from the tree, a diff from the git list, a subagent, a
 * terminal - and clicking a row opens (or focuses) its tab. Tabs drag to
 * reorder, close from their × or their context menu, and the strip grows an
 * overview button once the tabs stop fitting.
 */

/** Tabs the empty state offers as one-click launchers. */
const LAUNCHERS: Array<{
  kind: SidePaneTab["kind"];
  title: string;
  labelKey:
    | "sidePaneLauncherFiles"
    | "sidePaneLauncherGit"
    | "sidePaneLauncherTasks"
    | "sidePaneLauncherTerminal";
}> = [
  { kind: "workspace", title: "Files", labelKey: "sidePaneLauncherFiles" },
  { kind: "git", title: "Git", labelKey: "sidePaneLauncherGit" },
  { kind: "tasks", title: "Tasks", labelKey: "sidePaneLauncherTasks" },
  { kind: "terminal", title: "Terminal", labelKey: "sidePaneLauncherTerminal" },
];

const EXTRA_LAUNCHERS: Array<{
  kind: SidePaneTab["kind"];
  title: string;
  label: string;
}> = [
  { kind: "directory", title: "Agents", label: "Agents directory" },
  { kind: "team", title: "Team", label: "Team roster" },
  { kind: "automation", title: "Schedules", label: "Scheduled runs" },
];

function WorkspaceTab() {
  const { workspaces } = useWorkspaceRailData();
  return <FileTreePanel workspaces={workspaces} />;
}

function GitTab() {
  const { git } = useWorkspaceRailData();
  return <GitPanel git={git} />;
}

function TasksTab() {
  const subagents = useSessionStore((state) => state.subagents);
  const { approvals, setApprovals } = useWorkspaceRailData();
  const answer = (requestId: string, approved: boolean) => {
    void answerApproval(requestId, approved)
      .then(() =>
        setApprovals((items) =>
          items.filter((item) => item.requestId !== requestId),
        ),
      )
      .catch(() => {});
  };
  return (
    <>
      <ApprovalsPanel approvals={approvals} onAnswer={answer} />
      <SubagentsPanel subagents={subagents} />
    </>
  );
}

function TabContent({ tab }: { tab: SidePaneTab }) {
  switch (tab.kind) {
    case "file":
      return <FilePreviewPane path={tab.path ?? ""} />;
    case "diff":
      return <DiffPane path={tab.path ?? ""} />;
    case "workspace":
      return <WorkspaceTab />;
    case "git":
      return <GitTab />;
    case "tasks":
      return <TasksTab />;
    case "terminal":
      return <TerminalPanel />;
    case "subagent":
      return <SubagentPane agentName={tab.path ?? tab.title} />;
    case "directory":
      return <SubagentDirectoryPane />;
    case "team":
      return <TeamPane />;
    case "automation":
      return <AutomationsPane />;
  }
}

export function WorkspaceRail() {
  const tabs = useSidePaneStore((state) => state.tabs);
  const activeId = useSidePaneStore((state) => state.activeId);
  const openTab = useSidePaneStore((state) => state.openTab);
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);

  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  return (
    <aside className={css.rail}>
      {tabs.length > 0 ? (
        <SidePaneTabStrip tabs={tabs} activeId={activeId} />
      ) : null}

      <div className={css.body}>
        {active ? (
          <TabContent tab={active} />
        ) : (
          <div className={css.sidePaneEmpty}>
            <div className={css.sidePaneEmptyHint}>
              {copy.sidePaneEmptyHint}
            </div>
            <div className={css.sidePaneLaunchers}>
              {LAUNCHERS.map((launcher) => (
                <button
                  key={launcher.kind}
                  type="button"
                  className={css.sidePaneLauncher}
                  onClick={() =>
                    openTab({ kind: launcher.kind, title: launcher.title })
                  }
                >
                  <TabIcon kind={launcher.kind} />
                  <span>{copy[launcher.labelKey]}</span>
                </button>
              ))}
              {EXTRA_LAUNCHERS.map((launcher) => (
                <button
                  key={launcher.kind}
                  type="button"
                  className={css.sidePaneLauncher}
                  onClick={() =>
                    openTab({ kind: launcher.kind, title: launcher.title })
                  }
                >
                  <TabIcon kind={launcher.kind} />
                  <span>{launcher.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
