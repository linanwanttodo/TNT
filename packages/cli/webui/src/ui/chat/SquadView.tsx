import { SubagentsPanel } from "../shell/workspace-rail/SubagentsPanel.js";
import { ApprovalsPanel } from "../shell/workspace-rail/ApprovalsPanel.js";
import { answerApproval } from "../../api/client.js";
import { useWorkspaceRailData } from "../shell/workspace-rail/useWorkspaceRailData.js";
import { useSessionStore } from "../../stores/session-store.js";
import css from "./SquadView.module.css";

export function SquadView() {
  const { approvals, setApprovals } = useWorkspaceRailData();
  const subagents = useSessionStore((state) => state.subagents);
  return (
    <div className={css.frame}>
      <ApprovalsPanel
        approvals={approvals}
        onAnswer={(requestId, approved) => {
          void answerApproval(requestId, approved).then(() =>
            setApprovals((items) => items.filter((i) => i.requestId !== requestId)),
          );
        }}
      />
      <SubagentsPanel subagents={subagents} />
    </div>
  );
}
