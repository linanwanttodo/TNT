import { useState } from "react";

import { fetchGitFileDiff, type GitStatus } from "../../../api/client.js";
import { useSidePaneStore } from "../../../stores/side-pane-store.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { shellCopy } from "../ui-copy.js";
import css from "../WorkspaceRail.module.css";

/**
 * The git list, as the side pane's change browser. Clicking a changed file
 * opens its working-tree diff as its own tab in the pane.
 */
export function GitPanel({ git }: { git: GitStatus | null }) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const openTab = useSidePaneStore((state) => state.openTab);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (git === null) {
    return <div className={css.muted}>{copy.loadingGit}</div>;
  }
  if (!git.repo) {
    return <div className={css.muted}>{copy.notGitRepository}</div>;
  }

  const openDiff = (path: string) => {
    // The diff tab fetches on mount; this warm-up surfaces a broken
    // repository immediately instead of leaving a silently empty tab.
    setPending(path);
    setError(null);
    void fetchGitFileDiff(path)
      .then(() =>
        openTab({
          kind: "diff",
          title: path.split("/").pop() ?? path,
          path,
        }),
      )
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setPending(null));
  };

  return (
    <div>
      <div className={css.sectionTitle}>{git.branch ?? "detached"}</div>
      {git.changes.map((change) => (
        <button
          type="button"
          className={css.fileRow}
          key={change.path}
          title={`${change.path} - show diff`}
          onClick={() => openDiff(change.path)}
        >
          <span className={css.fileStatus} data-status={change.status}>
            {change.status === "untracked"
              ? "U"
              : change.status[0]?.toUpperCase()}
          </span>
          <span>{change.path}</span>
        </button>
      ))}
      {git.changes.length === 0 ? (
        <div className={css.muted}>{copy.clean}</div>
      ) : null}
      {pending !== null ? (
        <div className={css.muted}>Diffing {pending}...</div>
      ) : null}
      {error !== null ? (
        <div className={css.muted} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
