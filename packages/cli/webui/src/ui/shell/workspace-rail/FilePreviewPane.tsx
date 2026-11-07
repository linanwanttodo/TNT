import { useEffect, useState } from "react";

import { fetchWorkspaceFile, type WorkspaceFile } from "../../../api/client.js";
import css from "../WorkspaceRail.module.css";

/**
 * One file's contents, as a side-pane tab shows it. The read is capped
 * server-side; a failure reports why instead of an empty pane.
 */
export function FilePreviewPane({ path }: { path: string }) {
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchWorkspaceFile(path)
      .then((result) => {
        if (!cancelled) setFile(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setFile(null);
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

  if (loading) return <div className={css.muted}>Loading {path}...</div>;
  if (error !== null) {
    return (
      <div className={css.muted} role="alert">
        {error}
      </div>
    );
  }
  if (file === null) return null;
  return (
    <div className={css.filePreview}>
      <div className={css.filePreviewHead}>
        <span className={css.filePreviewPath}>{file.path}</span>
      </div>
      <pre className={css.filePreviewBody}>
        <code>{file.content}</code>
      </pre>
    </div>
  );
}
