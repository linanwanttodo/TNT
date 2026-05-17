import { useEffect, useRef, useState } from "react";

import type { ContextBreakdown, GitStatus } from "../../api/client.js";
import { ShellIcon } from "./icons.tsx";
import css from "./StatusMenu.module.css";

export interface StatusMenuProps {
  title: string;
  model: string;
  permissionMode?: string | undefined;
  context: ContextBreakdown | null;
  git: GitStatus | null;
  isProcessing: boolean;
  queueLength: number;
  hasPendingPermission: boolean;
}

/** Format a token count compactly, e.g. 1234567 -> "1.2M". */
function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

/**
 * The top status button and its popover: context budget, git commit, the
 * current task and background work in one place.
 */
export function StatusMenu({
  title,
  model,
  permissionMode,
  context,
  git,
  isProcessing,
  queueLength,
  hasPendingPermission,
}: StatusMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const percent = context
    ? Math.min(100, Math.max(0, Math.round(context.percentUsed)))
    : 0;
  const backgroundCount =
    queueLength + (isProcessing ? 1 : 0) + (hasPendingPermission ? 1 : 0);

  return (
    <div className={css.anchor} ref={anchorRef}>
      <button
        type="button"
        className={css.trigger}
        aria-label="Session status"
        aria-expanded={open}
        data-active={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ShellIcon glyph="lightning" size={13} />
        <span>{context ? `${percent}%` : "Status"}</span>
        {backgroundCount > 0 ? <span className={css.dot} /> : null}
      </button>

      {open ? (
        <div className={css.popover} role="dialog" aria-label="Session status">
          <div className={css.header}>
            <span className={css.headerTitle}>{title}</span>
            <span className={css.headerMeta}>{model}</span>
          </div>

          <section className={css.section}>
            <div className={css.sectionTitle}>Context</div>
            {context ? (
              <>
                <div className={css.metricRow}>
                  <span>Used</span>
                  <span>
                    {percent}% · {compactTokens(context.usedTokens)} /{" "}
                    {compactTokens(context.contextLimit)}
                  </span>
                </div>
                <div className={css.bar}>
                  <span style={{ width: `${percent}%` }} />
                </div>
                <div className={css.categories}>
                  <Category
                    label="System"
                    value={context.categories.systemPrompt}
                  />
                  <Category label="Tools" value={context.categories.tools} />
                  <Category
                    label="Conversation"
                    value={context.categories.conversation}
                  />
                  <Category
                    label="Tool results"
                    value={context.categories.toolResults}
                  />
                  <Category
                    label="Context"
                    value={context.categories.contextItems}
                  />
                </div>
              </>
            ) : (
              <div className={css.muted}>Context unavailable</div>
            )}
          </section>

          <section className={css.section}>
            <div className={css.sectionTitle}>Git</div>
            {git === null ? (
              <div className={css.muted}>Loading git status...</div>
            ) : git.repo ? (
              <>
                <Row
                  label="Branch"
                  value={git.branch ?? (git.detached ? "detached" : "—")}
                />
                <Row
                  label="Commit"
                  value={
                    git.latestCommit
                      ? `${git.latestCommit.hash} ${git.latestCommit.subject}`
                      : git.head.slice(0, 7)
                  }
                />
                <Row
                  label="Changes"
                  value={
                    git.changedFiles === 0
                      ? "Clean"
                      : `${git.changedFiles} changed`
                  }
                />
                {git.changedFiles === 0 ? null : (
                  <div className={css.changeList}>
                    {git.changes.slice(0, 8).map((change) => (
                      <div className={css.changeRow} key={change.path}>
                        <span className={css.changeStatus} data-status={change.status}>
                          {change.status === "untracked" ? "U" : change.status[0]?.toUpperCase()}
                        </span>
                        <span title={change.path}>{change.path}</span>
                      </div>
                    ))}
                    {git.changedFiles > 8 ? (
                      <div className={css.changeMore}>
                        +{git.changedFiles - 8} more
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className={css.muted}>Not a git repository</div>
            )}
          </section>

          <section className={css.section}>
            <div className={css.sectionTitle}>Task</div>
            <Row label="State" value={isProcessing ? "Running" : "Idle"} />
            <Row
              label="Queue"
              value={queueLength === 0 ? "Empty" : `${queueLength} queued`}
            />
            <Row
              label="Approval"
              value={hasPendingPermission ? "Waiting" : "None"}
            />
            <Row label="Permission" value={permissionMode ?? "default"} />
          </section>

          <section className={css.section}>
            <div className={css.sectionTitle}>Background</div>
            {backgroundCount === 0 ? (
              <div className={css.muted}>No background tasks</div>
            ) : (
              <>
                {isProcessing ? <Row label="Turn" value="Running" /> : null}
                {queueLength > 0 ? (
                  <Row label="Messages" value={`${queueLength} queued`} />
                ) : null}
                {hasPendingPermission ? (
                  <Row label="Permission" value="Waiting for approval" />
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <span className={css.rowValue} title={value}>
        {value}
      </span>
    </div>
  );
}

function Category({ label, value }: { label: string; value: number }) {
  return (
    <div className={css.category}>
      <span>{label}</span>
      <span>{compactTokens(value)}</span>
    </div>
  );
}
