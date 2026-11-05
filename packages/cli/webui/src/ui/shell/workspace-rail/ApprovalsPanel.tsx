import type { PendingPermissionSummary } from "../../../api/client.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { shellCopy } from "../ui-copy.js";
import css from "../WorkspaceRail.module.css";

export function ApprovalsPanel({
  approvals,
  onAnswer,
}: {
  approvals: PendingPermissionSummary[];
  onAnswer: (requestId: string, approved: boolean) => void;
}) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  return (
    <div>
      <div className={css.sectionTitle}>{copy.approvals}</div>
      {approvals.length === 0 ? (
        <div className={css.muted}>{copy.noApprovals}</div>
      ) : (
        approvals.map((approval) => (
          <div className={css.approval} key={approval.requestId}>
            <div className={css.approvalTitle}>{approval.toolName}</div>
            <div className={css.approvalActions}>
              <button type="button" onClick={() => onAnswer(approval.requestId, true)}>
                {copy.approve}
              </button>
              <button
                type="button"
                data-danger="true"
                onClick={() => onAnswer(approval.requestId, false)}
              >
                {copy.deny}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
