import { useState } from "react";

import { answerApproval } from "../../api/client.js";
import { useSessionStore } from "../../stores/session-store.js";
import { ShellIcon } from "./icons.tsx";
import { ApprovalsPanel } from "./workspace-rail/ApprovalsPanel.tsx";
import { FileTreePanel } from "./workspace-rail/FileTreePanel.tsx";
import { GitPanel } from "./workspace-rail/GitPanel.tsx";
import { SubagentsPanel } from "./workspace-rail/SubagentsPanel.tsx";
import { TerminalPanel } from "./workspace-rail/TerminalPanel.tsx";
import { useTabs } from "./workspace-rail/tabs.js";
import { useWorkspaceRailData } from "./workspace-rail/useWorkspaceRailData.js";
import type { TabId } from "./workspace-rail/types.js";
import css from "./WorkspaceRail.module.css";

export function WorkspaceRail() {
  const [active, setActive] = useState<TabId>("git");
  const tabs = useTabs();
  const subagents = useSessionStore((state) => state.subagents);
  const { workspaces, git, approvals, setApprovals } = useWorkspaceRailData();

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
    <aside className={css.rail}>
      <div className={css.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={css.tab}
            data-active={active === tab.id}
            onClick={() => setActive(tab.id)}
          >
            <ShellIcon glyph={tab.glyph} size={13} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className={css.body}>
        {active === "files" ? <FileTreePanel workspaces={workspaces} /> : null}
        {active === "git" ? <GitPanel git={git} /> : null}
        {active === "tasks" ? (
          <>
            <ApprovalsPanel approvals={approvals} onAnswer={answer} />
            <SubagentsPanel subagents={subagents} />
          </>
        ) : null}
        {active === "terminal" ? <TerminalPanel /> : null}
      </div>
    </aside>
  );
}
