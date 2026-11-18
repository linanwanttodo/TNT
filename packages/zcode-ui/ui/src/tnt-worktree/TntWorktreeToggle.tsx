// 新建任务 composer 头部的 worktree 复选框与分支选择（docs/git/worktree.md §3.2）。
// 开关与所选分支存放在 draft store，每次新建草稿重置为关闭；这里不持有第二份状态。
// 按钮与分支选择 1:1 搬运 ZCode managed-worktrees/WorktreeComposerControls.tsx。
import { CheckIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import type { ManagedWorktreeStartRefs } from "@zcode/shared";
import { TID_WORKTREE_TOGGLE } from "@zcode/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { cn } from "@/components/lib/utils.js";
import {
  useTntDraftWorktreeStore,
} from "@/tnt-worktree/draftWorktreeStore.js";

/** 分支很多时只展示前若干项，保持菜单紧凑。 */
const MAX_LISTED_REFS = 30;
const SHORT_SHA_LENGTH = 7;

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

  const onCheckedChange = useCallback(
    (checked: boolean) => {
      setEnabled(workspacePath, checked);
      if (!checked) {
        useTntDraftWorktreeStore.getState().setRef(workspacePath, undefined);
      }
    },
    [setEnabled, workspacePath],
  );

  if (available !== true) return null;

  return (
    <label
      title={intl.formatMessage({ id: "tnt.worktree.tooltip" })}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer select-none items-center gap-2 rounded-full px-3 text-ui-base/relaxed text-foreground-subtle hover:bg-hover hover:text-foreground",
      )}
    >
      <Checkbox
        data-tnt-worktree-toggle="true"
        checked={enabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={intl.formatMessage({
          id: "tnt.worktree.checkbox.ariaLabel",
        })}
      />
      <span>{intl.formatMessage({ id: "tnt.worktree.checkbox" })}</span>
    </label>
  );
}

/**
 * worktree 模式下的分支胶囊：只记录新 worktree 从哪个分支检出，不切换主目录（§3.2）。
 * 文字与普通分支胶囊相同，只显示分支名。listStartRefs 由调用方提供（TNT 侧适配）。
 */
export function TntWorktreeBranchPicker({
  selectedRef,
  currentBranchLabel,
  listStartRefs,
  onSelect,
  className,
}: {
  selectedRef: string | null;
  currentBranchLabel: string;
  listStartRefs: () => Promise<ManagedWorktreeStartRefs | null>;
  onSelect: (ref: string | null) => void;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<ManagedWorktreeStartRefs | null>(null);

  useEffect(() => {
    if (!open || !listStartRefs) return;
    let disposed = false;
    void listStartRefs().then(
      (next) => {
        if (!disposed) setRefs(next);
      },
      (error: unknown) => logger.warn("[worktree] 读取分支候选失败", { error }),
    );
    return () => {
      disposed = true;
    };
  }, [listStartRefs, open]);

  const head = refs?.head ?? null;
  const headLabel = head
    ? head.branchName ??
      intl.formatMessage(
        { id: "tnt.worktree.refHead" },
        { sha: head.sha.slice(0, SHORT_SHA_LENGTH) },
      )
    : currentBranchLabel;
  const triggerLabel = selectedRef ?? currentBranchLabel;

  return (
    <div className={cn("flex items-center px-1 pt-2", className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="default"
            data-worktree-branch-picker="true"
            className="min-w-0 max-w-full rounded-full pl-3 pr-2 text-ui-base/relaxed"
          >
            <GitBranchIcon className="size-4 text-foreground-subtle" />
            <span className="min-w-0 max-w-25 truncate text-left">
              {triggerLabel}
            </span>
            <ChevronDownIcon className="size-3.5 text-foreground-subtle" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          avoidCollisions={false}
          className="max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
        >
          <DropdownMenuLabel className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "tnt.worktree.refTitle" })}
          </DropdownMenuLabel>
          <RefItem
            label={intl.formatMessage(
              { id: "tnt.worktree.refHead" },
              { ref: headLabel },
            )}
            selected={selectedRef === null}
            onSelect={() => onSelect(null)}
          />
          <RefGroup
            label={intl.formatMessage({ id: "tnt.worktree.refLocal" })}
            refs={refs?.localBranches ?? []}
            selectedRef={selectedRef}
            onSelect={onSelect}
          />
          <RefGroup
            label={intl.formatMessage({ id: "tnt.worktree.refRemote" })}
            refs={refs?.remoteBranches ?? []}
            selectedRef={selectedRef}
            onSelect={onSelect}
          />
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "tnt.worktree.refHint" })}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RefItem({
  label,
  selected,
  onSelect,
  mono,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  mono?: boolean;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="justify-between gap-2">
      <span
        className={cn("min-w-0 truncate", mono && "font-mono text-ui-sm")}
        title={label}
      >
        {label}
      </span>
      {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}

function RefGroup({
  label,
  refs,
  selectedRef,
  onSelect,
}: {
  label: string;
  refs: readonly string[];
  selectedRef: string | null;
  onSelect: (ref: string) => void;
}) {
  if (refs.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-ui-sm text-foreground-subtle">
        {label}
      </DropdownMenuLabel>
      {refs.slice(0, MAX_LISTED_REFS).map((ref) => (
        <RefItem
          key={ref}
          label={ref}
          mono
          selected={selectedRef === ref}
          onSelect={() => onSelect(ref)}
        />
      ))}
    </>
  );
}
