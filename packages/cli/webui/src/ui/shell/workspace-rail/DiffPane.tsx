import { useEffect, useState } from "react";

import { fetchGitFileDiff } from "../../../api/client.js";
import css from "../WorkspaceRail.module.css";

/** One file's working-tree diff, as a side-pane tab shows it. */
export function DiffPane({ path }: { path: string }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchGitFileDiff(path)
      .then((result) => {
        if (!cancelled) setDiff(result.diff);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setDiff(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loading) return <div className={css.muted}>Diffing {path}...</div>;
  if (error !== null) {
    return (
      <div className={css.muted} role="alert">
        {error}
      </div>
    );
  }
  return (
    <div className={css.filePreview}>
      <div className={css.filePreviewHead}>
        <span className={css.filePreviewPath}>{path}</span>
      </div>
      <pre className={css.filePreviewBody}>
        <code>{diff || "(no diff)"}</code>
      </pre>
    </div>
  );
}
