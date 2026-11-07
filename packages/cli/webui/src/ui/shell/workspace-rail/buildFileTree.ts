export interface FileTreeNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[];
}

export function buildFileTree(files: string[], root: string): FileTreeNode {
  const tree: FileTreeNode = {
    path: root,
    name: root,
    kind: "directory",
    children: [],
  };
  for (const file of files) {
    const relative = file.replace(`${root}/`, "");
    const parts = relative.split("/");
    let node = tree;
    for (const part of parts) {
      const isFile = part === parts[parts.length - 1];
      let child = node.children.find((entry) => entry.name === part);
      if (!child) {
        child = {
          path: `${node.path}/${part}`,
          name: part,
          kind: isFile ? "file" : "directory",
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  const sort = (node: FileTreeNode) => {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    node.children.forEach(sort);
  };
  sort(tree);
  return tree;
}
