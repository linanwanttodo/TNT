import { useState } from "react";
import css from "./ChangedFilesPill.module.css";

export function ChangedFilesPill({
  files,
  compact = false,
}: {
  files: string[];
  compact?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;

  if (compact) {
    return (
      <div className={css.anchor}>
        <button
          type="button"
          className={css.pill}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            {files.length} {files.length === 1 ? "file changed" : "files changed"}
          </span>
        </button>
        {open ? (
          <div className={css.popover} role="dialog" aria-label="Changed files">
            {files.map((file) => (
              <div className={css.fileRow} key={file} title={file}>
                <span>{file}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={css.card}>
      <div className={css.cardHeader}>
        <span>
          Edited {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        <button type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide changes" : "View changes"}
        </button>
      </div>
      {open ? (
        <div className={css.cardList}>
          {files.map((file) => (
            <div className={css.fileRow} key={file} title={file}>
              <span>{file}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
