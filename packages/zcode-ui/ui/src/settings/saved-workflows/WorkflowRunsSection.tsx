import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ZCodeWorkflowRunSummary } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/components/lib/utils.js";
import { SETTINGS_FRAME_CONTENT_CLASSNAME } from "@/settings/SettingsPageParts.js";

/**
 * The Workflow tab of the automations page.
 *
 * A scheduled task and a team run are the same thing from the user's side:
 * something runs without them typing. A cron task is a prompt on a clock; a
 * team run is a prompt that fans out to subagents. TNT keeps both on the same
 * page — the cron tab on the clock, this tab on the runs — and this one reads
 * the team-run ledger the sessions carry.
 *
 * The list is a plain read: no synthetic entries, no placeholders. A workspace
 * that has never run a team says so.
 */
export function WorkflowRunsSection({
  header,
  workspacePath,
  onOpenSession,
}: {
  header?: ReactNode;
  workspacePath?: string | null;
  /** 打开一次运行所属的会话。 */
  onOpenSession?: (sessionId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useServices();
  const [runs, setRuns] = useState<readonly ZCodeWorkflowRunSummary[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setRuns([]);
      return;
    }
    setLoading(true);
    try {
      const listed = await zcodeAgentService.listWorkflowRuns({
        workspacePath,
        limit: 64,
      });
      setRuns(listed);
    } catch {
      // A workspace with no runs and a workspace the service cannot read are
      // both "nothing to show"; the empty state says which it is not.
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, zcodeAgentService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div
      data-workflow-runs-content
      className={cn(SETTINGS_FRAME_CONTENT_CLASSNAME, "flex flex-col")}
    >
      {header}

      <div className="mt-6 flex flex-col gap-2">
        {loading && runs === null ? (
          <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
            <Spinner />
            {intl.formatMessage({ id: "workflows.runs.loading" })}
          </div>
        ) : null}

        {!loading && runs !== null && runs.length === 0 ? (
          <div className="rounded-[10px] border border-card-border px-3 py-3 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "workflows.runs.empty" })}
          </div>
        ) : null}

        {runs?.map((run) => (
          <button
            key={`${run.sessionId}:${run.runId}`}
            type="button"
            onClick={() => onOpenSession?.(run.sessionId)}
            className={cn(
              "rounded-[10px] border border-card-border px-3 py-2 text-left",
              "transition-colors hover:bg-hover focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-input-border-focused",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-ui-base font-medium text-foreground">
                {run.label}
              </span>
              <span className="shrink-0 text-ui-small text-foreground-subtlest">
                {intl.formatMessage(
                  { id: `workflows.runs.status.${run.status}` },
                  { time: formatTime(run.updatedAt) },
                )}
              </span>
            </div>
            <div className="mt-1 truncate text-ui-small text-foreground-subtle">
              {run.sessionTitle}
            </div>
            {run.failureMessage ? (
              <div className="mt-1 truncate text-ui-small text-foreground-subtlest">
                {run.failureMessage}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}
