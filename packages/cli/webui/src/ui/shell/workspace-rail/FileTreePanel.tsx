import { useState } from "react";

import type { WorkspacesResponse } from "../../../api/client.js";
import { useSidePaneStore } from "../../../stores/side-pane-store.js";
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
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  if (node.kind === "file") {
    return (
      <button
        type="button"
        className={css.treeRow}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={node.path}
        onClick={() => onOpenFile(node.path)}
      >
        <span>{node.name}</span>
      </button>
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
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </>
  );
}

/**
 * The workspace tree, as the side pane's file browser. Clicking a file opens
 * it as its own tab in the pane - no fixed preview slot; every view the user
 * opens lives in a tab.
 */
export function FileTreePanel({
  workspaces,
}: {
  workspaces: WorkspacesResponse | null;
}) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const openTab = useSidePaneStore((state) => state.openTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const openFile = (path: string) => {
    openTab({
      kind: "file",
      title: path.split("/").pop() ?? path,
      path,
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
            onOpenFile={openFile}
          />
        </section>
      ))}
      {workspaces === null ? (
        <div className={css.muted}>{copy.loadingFiles}</div>
      ) : null}
    </div>
  );
}
