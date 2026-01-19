import {
  getImportGraphService,
  type ImportGraphService,
} from "../retrieval/importGraph.js";

import { Tool } from "./types.js";

const MAX_HITS = 100;

type ImportAction = "dependencies" | "dependents";

export const importGraphDeps: {
  service: () => ImportGraphService;
} = {
  service: () => getImportGraphService(),
};

function labelFor(action: ImportAction, count: number): string {
  if (action === "dependencies") {
    return count === 1 ? "dependency" : "dependencies";
  }
  return count === 1 ? "dependent" : "dependents";
}

function formatHit(hit: { path: string; depth: number; via?: string }): string {
  if (hit.depth > 1) {
    const via = hit.via ? `, via ${hit.via}` : "";
    return `${hit.path} (depth ${hit.depth}${via})`;
  }
  return hit.via ? `${hit.path} (via ${hit.via})` : hit.path;
}

/**
 * The persisted file-level import graph: what a file imports, or who imports
 * it, including transitive edges. Symbol resolution and call edges belong to
 * the language-server tools; this answers the module graph without a server.
 */
export const importGraphTool: Tool = {
  name: "ImportGraph",
  displayName: "Import Graph",
  description: `Read the workspace's persisted import graph.
dependencies lists the workspace files a file imports; dependents lists the files that import it. depth (1-5) follows resolved edges transitively. External package specifiers are reported separately.
The graph is built from line-anchored import declarations and refreshed from changed file contents on each call; it does not resolve symbols or calls.`,
  parameters: {
    type: "object",
    required: ["action", "file_path"],
    properties: {
      action: {
        type: "string",
        enum: ["dependencies", "dependents"],
        description: "dependencies or dependents",
      },
      file_path: {
        type: "string",
        description: "Path to the file, absolute or relative to the project",
      },
      depth: {
        type: "number",
        description: "How many resolved edges to follow, 1 to 5; default 1",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    action,
    file_path,
    depth,
  }: {
    action: ImportAction;
    file_path: string;
    depth?: number;
  }): Promise<string> => {
    if (action !== "dependencies" && action !== "dependents") {
      return 'ImportGraph action must be "dependencies" or "dependents".';
    }
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "ImportGraph needs a file_path argument.";
    }
    const requested = depth === undefined ? 1 : Number(depth);
    if (!Number.isInteger(requested) || requested < 1 || requested > 5) {
      return "ImportGraph depth must be between 1 and 5.";
    }

    const service = importGraphDeps.service();
    await service.refresh();
    const hits =
      action === "dependencies"
        ? await service.dependencies(file_path, requested)
        : await service.dependents(file_path, requested);
    const external =
      action === "dependencies" && requested === 1
        ? await service.unresolved(file_path)
        : [];

    if (hits.length === 0 && external.length === 0) {
      return `No ${labelFor(action, 0)} recorded for ${file_path}.`;
    }

    const label = labelFor(action, hits.length);
    const shown = hits.slice(0, MAX_HITS);
    const lines = shown.map(formatHit);
    const cut =
      hits.length > shown.length
        ? `\n[showing ${shown.length} of ${hits.length}; use a shallower depth]`
        : "";
    const externalLine =
      external.length > 0 ? `\nExternal: ${external.join(", ")}` : "";
    return `${hits.length} ${label} of ${file_path}:\n${lines.join("\n")}${externalLine}${cut}`;
  },
};
