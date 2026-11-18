import { useCallback, useEffect, useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import {
  readTntDraftWorktreeState,
  useTntDraftWorktreeStore,
} from "@/tnt-worktree/draftWorktreeStore.js";

/**
 * The worktree checkbox at the right end of the draft composer header
 * (docs/git/worktree.md §3.2): `[project ▾] [branch ▾] … [☐ worktree]`.
 *
 * The checkbox is a pill that matches the project and branch capsules' height
 * contract (`h-7`); a tooltip names what it does. Turning it on does not add
 * any control or change the branch capsule: selecting a branch still switches
 * the checkout, and the managed worktree is created from that checkout on the
 * first send (the same shape as ZCode).
 *
 * The checkbox hides itself on hosts without the capability and on
 * non-repository workspaces - fail-closed, like the availability it mirrors.
 */
export function TntWorktreeToggle({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useServices();
  const [available, setAvailable] = useState<boolean | null>(null);
  const enabled = useTntDraftWorktreeStore(
    (state) => state.read(workspacePath).enabled,
  );
  const setEnabled = useTntDraftWorktreeStore((state) => state.setEnabled);

  useEffect(() => {
    let disposed = false;
    void zcodeAgentService
      .managedWorktreeAvailable({ workspacePath, workspaceIdentity })
      .then((ok) => {
        if (!disposed) setAvailable(ok);
      })
      .catch(() => {
        if (!disposed) setAvailable(false);
      });
    return () => {
      disposed = true;
    };
  }, [workspacePath, workspaceIdentity, zcodeAgentService]);

  const onToggle = useCallback(() => {
    const next = !readTntDraftWorktreeState(workspacePath).enabled;
    // Off clears the recorded ref with it: a stale ref must not survive into
    // a later, unrelated worktree send.
    setEnabled(workspacePath, next);
    if (!next) {
      useTntDraftWorktreeStore.getState().setRef(workspacePath, undefined);
    }
  }, [setEnabled, workspacePath]);

  if (available !== true) return null;

  return (
    <ControlHintTooltip
      standalone
      side="top"
      title={intl.formatMessage({ id: "tnt.worktree.tooltip" })}
    >
      <label
        data-tnt-worktree-toggle="true"
        className={cn(
          // 与项目/分支胶囊同一高度契约（h-7）；全圆角边框胶囊，文字始终用
          // foreground，不靠 hover 才变亮。hover 只换背景色，克制无动画。
          "ml-auto flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3",
          "text-ui-small text-foreground transition-colors",
          enabled
            ? "border-input-border-focused bg-selected"
            : "border-card-border hover:bg-hover",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-input-border-focused",
        )}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          aria-label={intl.formatMessage({
            id: "tnt.worktree.checkbox.ariaLabel",
          })}
          className="size-3.5 accent-[currentColor]"
        />
        <span className="select-none">
          {intl.formatMessage({ id: "tnt.worktree.checkbox" })}
        </span>
      </label>
    </ControlHintTooltip>
  );
}
