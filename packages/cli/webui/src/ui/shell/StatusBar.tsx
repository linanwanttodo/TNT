/**
 * The strip under the conversation: where the run happens, which worktree it
 * is attached to, which permissions it holds and which model answers.
 */
import { useEffect, useRef, useState } from "react";

import {
  PERMISSION_MODE_OPTIONS,
  setPermissionMode,
  type ChatModelOption,
  type ContextBreakdown,
  type PermissionMode,
  type WorktreeInfo,
} from "../../api/client.js";
import { ShellIcon } from "./icons.tsx";
import css from "./StatusBar.module.css";

/** Props the status bar renders from. */
export interface StatusBarProps {
  /** Workspace folder the session runs in; absent hides the chip rather than naming a folder the session never reported. */
  workspace?: string | undefined;
  /** The chat models the session may run on; empty hides the picker. */
  models?: ChatModelOption[] | undefined;
  /** The model in use, or null before the session reports one. */
  currentModel?: ChatModelOption | null | undefined;
  /** Switch the session to the model at this position in the list. */
  onPickModel?: ((index: number) => void) | undefined;
  /** The repository's checkouts; empty hides the chip. */
  worktrees?: WorktreeInfo[] | undefined;
  /** The checkout the process is in, or null outside a repository. */
  currentWorktree?: WorktreeInfo | null | undefined;
  /** Whether the page may move the process into another checkout. */
  worktreeSwitchable?: boolean | undefined;
  /** True once a checkout has been picked in this page session. */
  worktreeChosen?: boolean | undefined;
  /** Move the process into this checkout. */
  onPickWorktree?: ((path: string) => void) | undefined;
  /** Permission mode shown as a pill. */
  permissionMode?: string | undefined;
  /** True while the server is running a turn. */
  isProcessing?: boolean | undefined;
  /** The context window usage, or null before it has been fetched. */
  contextBreakdown?: ContextBreakdown | null | undefined;
  /** The workspace path behind the folder chip, shown as its tooltip. */
  workspaceDirectory?: string | undefined;
  /** Open the workspace folder; absent leaves the chip as a plain label. */
  onOpenWorkspace?: (() => void) | undefined;
}

/** Label the pill shows for a mode; unknown modes render verbatim. */
function modeLabel(mode: string | undefined): string {
  const option = PERMISSION_MODE_OPTIONS.find((o) => o.mode === mode);
  return option ? option.label : (mode ?? "");
}

/** The checkout's label on its chip: the branch it holds, else "Worktree". */
function worktreeLabel(worktree: WorktreeInfo | null | undefined): string {
  return worktree?.branch ?? "Worktree";
}

/** Format a token count compactly, e.g. 1234567 -> "1.2M". */
function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

/**
 * The status strip.
 * @param props - the labels to show.
 * @returns the status bar element.
 */
export function StatusBar({
  workspace,
  models = [],
  currentModel = null,
  onPickModel,
  worktrees = [],
  currentWorktree = null,
  worktreeSwitchable = false,
  worktreeChosen = false,
  onPickWorktree,
  permissionMode = "default",
  isProcessing = false,
  contextBreakdown = null,
  workspaceDirectory,
  onOpenWorkspace,
}: StatusBarProps) {
  const [open, setOpen] = useState<
    null | "mode" | "model" | "worktree" | "context"
  >(null);
  const [current, setCurrent] = useState<PermissionMode | string | undefined>(
    permissionMode,
  );
  const modeRef = useRef<HTMLSpanElement | null>(null);
  const modelRef = useRef<HTMLSpanElement | null>(null);
  const worktreeRef = useRef<HTMLSpanElement | null>(null);
  const contextRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setCurrent(permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    if (open === null) return;
    const onDown = (ev: MouseEvent) => {
      const anchors = [
        modeRef.current,
        modelRef.current,
        worktreeRef.current,
        contextRef.current,
      ];
      if (!anchors.some((ref) => ref?.contains(ev.target as Node))) {
        setOpen(null);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (mode: PermissionMode) => {
    setOpen(null);
    const previous = current;
    setCurrent(mode);
    setPermissionMode(mode)
      .then((confirmed) => {
        if (confirmed) {
          setCurrent(confirmed);
        }
      })
      .catch(() => {
        // The session never adopted the mode; showing it would be a lie.
        setCurrent(previous);
      });
  };

  const modelLabel = currentModel?.name ?? "";
  const canPickModel = models.length > 0;
  const showWorktree = worktrees.length > 0 || currentWorktree !== null;

  return (
    <footer className={css.statusBar}>
      <span className={css.entries}>
        {workspace ? (
          <span
            className={css.entry}
            title={workspaceDirectory}
            onClick={onOpenWorkspace}
            role={onOpenWorkspace ? "button" : undefined}
            data-clickable={onOpenWorkspace ? "true" : undefined}
          >
            <ShellIcon glyph="folder" size={14} className={css.entryIcon} />
            <span>{workspace}</span>
          </span>
        ) : null}
        {showWorktree ? (
          worktreeSwitchable ? (
            <span className={css.modeAnchor} ref={worktreeRef}>
              {open === "worktree" ? (
                <div className={css.menu} role="menu">
                  <div className={css.menuTitle}>Worktree · this session</div>
                  {worktrees.map((worktree) => (
                    <button
                      key={worktree.path}
                      type="button"
                      role="menuitem"
                      className={css.menuItem}
                      onClick={() => {
                        setOpen(null);
                        onPickWorktree?.(worktree.path);
                      }}
                    >
                      <span className={css.menuItemTexts}>
                        <span className={css.menuItemLabel}>
                          {worktreeLabel(worktree)}
                        </span>
                        <span className={css.menuItemDescription}>
                          {worktree.path}
                        </span>
                      </span>
                      {currentWorktree?.path === worktree.path ? (
                        <span className={css.menuCheck} aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className={css.worktree}
                data-chosen={worktreeChosen ? "true" : "false"}
                onClick={() =>
                  setOpen((v) => (v === "worktree" ? null : "worktree"))
                }
              >
                <ShellIcon glyph="branch" size={12} />
                <span>{worktreeLabel(currentWorktree)}</span>
              </button>
            </span>
          ) : (
            <span
              className={css.worktree}
              data-chosen={worktreeChosen ? "true" : "false"}
            >
              <ShellIcon glyph="branch" size={12} />
              <span>{worktreeLabel(currentWorktree)}</span>
            </span>
          )
        ) : null}
      </span>
      <span className={css.right}>
        <span className={css.modeAnchor} ref={modeRef}>
          {open === "mode" ? (
            <div className={css.menu} role="menu">
              <div className={css.menuTitle}>Permissions · this session</div>
              {PERMISSION_MODE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  role="menuitem"
                  className={css.menuItem}
                  onClick={() => pick(option.mode)}
                >
                  <span className={css.menuItemTexts}>
                    <span className={css.menuItemLabel}>{option.label}</span>
                    <span className={css.menuItemDescription}>
                      {option.description}
                    </span>
                  </span>
                  {current === option.mode ? (
                    <span className={css.menuCheck} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={css.pill}
            onClick={() => setOpen((v) => (v === "mode" ? null : "mode"))}
          >
            {modeLabel(current)}
          </button>
        </span>
        {canPickModel ? (
          <span className={css.modeAnchor} ref={modelRef}>
            {open === "model" ? (
              <div className={css.menu} role="menu">
                <div className={css.menuTitle}>Model · this session</div>
                {models.map((option) => (
                  <button
                    key={option.index}
                    type="button"
                    role="menuitem"
                    className={css.menuItem}
                    onClick={() => {
                      setOpen(null);
                      onPickModel?.(option.index);
                    }}
                  >
                    <span className={css.menuItemTexts}>
                      <span className={css.menuItemLabel}>{option.name}</span>
                      <span className={css.menuItemDescription}>
                        {option.provider}
                      </span>
                    </span>
                    {option.index === currentModel?.index ? (
                      <span className={css.menuCheck} aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className={css.model}
              onClick={() => setOpen((v) => (v === "model" ? null : "model"))}
            >
              <span key={modelLabel} className="zcode-roll-label">
                {modelLabel}
              </span>
            </button>
          </span>
        ) : modelLabel ? (
          <span className={css.model}>{modelLabel}</span>
        ) : null}
        {contextBreakdown ? (
          <span className={css.modeAnchor} ref={contextRef}>
            {open === "context" ? (
              <div className={css.menu} role="menu">
                <div className={css.menuTitle}>Context · this session</div>
                <div className={css.contextHead}>
                  <span className={css.contextTotal}>
                    {compactTokens(contextBreakdown.usedTokens)}
                  </span>
                  <span className={css.contextHeadTexts}>
                    <span className={css.contextHeadLabel}>Total tokens</span>
                    <span className={css.contextHeadDescription}>
                      {Math.round(contextBreakdown.percentUsed)}% of{" "}
                      {compactTokens(contextBreakdown.contextLimit)} context
                    </span>
                  </span>
                </div>
                <div className={css.contextRows}>
                  <div className={css.contextRow}>
                    <span className={css.contextRowLabel}>System prompt</span>
                    <span className={css.contextRowValue}>
                      {compactTokens(contextBreakdown.categories.systemPrompt)}
                    </span>
                  </div>
                  <div className={css.contextRow}>
                    <span className={css.contextRowLabel}>
                      Tool definitions
                    </span>
                    <span className={css.contextRowValue}>
                      {compactTokens(contextBreakdown.categories.tools)}
                    </span>
                  </div>
                  <div className={css.contextRow}>
                    <span className={css.contextRowLabel}>
                      Conversation messages
                    </span>
                    <span className={css.contextRowValue}>
                      {compactTokens(contextBreakdown.categories.conversation)}
                    </span>
                  </div>
                  <div className={css.contextRow}>
                    <span className={css.contextRowLabel}>Tool results</span>
                    <span className={css.contextRowValue}>
                      {compactTokens(contextBreakdown.categories.toolResults)}
                    </span>
                  </div>
                  <div className={css.contextRow}>
                    <span className={css.contextRowLabel}>Free space</span>
                    <span className={css.contextRowValue}>
                      {compactTokens(contextBreakdown.freeTokens)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className={css.contextButton}
              aria-label={`Context ${Math.round(
                contextBreakdown.percentUsed,
              )}% used`}
              onClick={() =>
                setOpen((v) => (v === "context" ? null : "context"))
              }
            >
              <svg
                className={css.contextRing}
                viewBox="0 0 20 20"
                width={18}
                height={18}
                aria-hidden="true"
              >
                <circle
                  className={css.contextRingTrack}
                  cx="10"
                  cy="10"
                  r="8"
                />
                <circle
                  className={css.contextRingValue}
                  cx="10"
                  cy="10"
                  r="8"
                  strokeDasharray={`${
                    Math.max(0, Math.min(100, contextBreakdown.percentUsed)) *
                    0.5027
                  } 50.27`}
                />
              </svg>
              <span className={css.contextPercent}>
                {Math.round(contextBreakdown.percentUsed)}%
              </span>
            </button>
          </span>
        ) : null}
        {isProcessing ? (
          <span className={css.spinner} role="img" aria-label="Working" />
        ) : null}
      </span>
    </footer>
  );
}
