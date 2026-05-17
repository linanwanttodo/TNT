import type { GitStatus } from "../../../api/client.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { shellCopy } from "../ui-copy.js";
import css from "../WorkspaceRail.module.css";

export function GitPanel({ git }: { git: GitStatus | null }) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  if (git === null) {
    return <div className={css.muted}>{copy.loadingGit}</div>;
  }
  if (!git.repo) {
    return <div className={css.muted}>{copy.notGitRepository}</div>;
  }
  return (
    <div>
      <div className={css.sectionTitle}>{git.branch ?? "detached"}</div>
      {git.changes.map((change) => (
        <div className={css.fileRow} key={change.path}>
          <span className={css.fileStatus} data-status={change.status}>
            {change.status === "untracked"
              ? "U"
              : change.status[0]?.toUpperCase()}
          </span>
          <span title={change.path}>{change.path}</span>
        </div>
      ))}
      {git.changes.length === 0 ? (
        <div className={css.muted}>{copy.clean}</div>
      ) : null}
    </div>
  );
}
