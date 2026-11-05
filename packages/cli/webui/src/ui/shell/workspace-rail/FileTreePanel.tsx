import { useState } from "react";
import type { WorkspacesResponse } from "../../../api/client.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { ShellIcon } from "../icons.tsx";
import { shellCopy } from "../ui-copy.js";
import { buildFileTree, type FileTreeNode } from "./buildFileTree.js";
import css from "../WorkspaceRail.module.css";

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  if (node.kind === "file") {
    return (
      <div className={css.treeRow} style={{ paddingLeft: `${depth * 12 + 6}px` }}>
        <span>{node.name}</span>
      </div>
    );
  }
  const open = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        className={css.treeRow}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        data-open={open}
        onClick={() => onToggle(node.path)}
      >
        <ShellIcon glyph="folder" size={12} />
        <span>{node.name}</span>
      </button>
      {open
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

export function FileTreePanel({
  workspaces,
}: {
  workspaces: WorkspacesResponse | null;
}) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className={css.files}>
      {workspaces?.workspaces.map((workspace) => (
        <section key={workspace.path}>
          <div className={css.sectionTitle}>{workspace.name}</div>
          <TreeRow
            node={buildFileTree(workspace.files, workspace.path)}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
          />
        </section>
      ))}
      {workspaces === null ? (
        <div className={css.muted}>{copy.loadingFiles}</div>
      ) : null}
    </div>
  );
}
