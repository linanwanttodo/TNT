import { randomUUID } from "crypto";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";

import { markFileAsSeen } from "./fileState.js";
import { Tool } from "./types.js";
import {
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "./workspaceFiles.js";

type CellType = "code" | "markdown";
type EditMode = "replace" | "insert" | "delete";

interface NotebookCell {
  id?: string;
  cell_type?: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  [key: string]: unknown;
}

interface Notebook {
  cells: NotebookCell[];
  [key: string]: unknown;
}

export interface NotebookEditArgs {
  filepath: string;
  edit_mode?: EditMode;
  cell_id?: string;
  cell_index?: number;
  new_source?: string;
  cell_type?: CellType;
}

/** Keep the shape the notebook already uses: a string or the line array. */
function sourceValue(text: string, like: unknown): string | string[] {
  if (!Array.isArray(like)) {
    return text;
  }
  const lines = text.split("\n");
  return lines
    .map((line, index) => (index === lines.length - 1 ? line : `${line}\n`))
    .filter((line, index) => index < lines.length - 1 || line !== "");
}

function locateCell(
  cells: NotebookCell[],
  args: NotebookEditArgs,
): { index: number; cell: NotebookCell } {
  if (typeof args.cell_id === "string" && args.cell_id !== "") {
    const index = cells.findIndex((cell) => cell.id === args.cell_id);
    if (index < 0) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `No cell with id ${args.cell_id} in ${args.filepath}.`,
      );
    }
    return { index, cell: cells[index] };
  }

  if (typeof args.cell_index === "number") {
    if (
      !Number.isInteger(args.cell_index) ||
      args.cell_index < 0 ||
      args.cell_index >= cells.length
    ) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Cell index ${args.cell_index} is out of range for ${args.filepath}.`,
      );
    }
    return { index: args.cell_index, cell: cells[args.cell_index] };
  }

  throw new ContinueError(
    ContinueErrorReason.Unspecified,
    "NotebookEdit needs cell_id or cell_index for this edit.",
  );
}

function assertCellType(value: unknown): CellType {
  if (value !== "code" && value !== "markdown") {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Unsupported notebook cell type: ${String(value)}. Use code or markdown.`,
    );
  }
  return value;
}

function newCell(
  args: NotebookEditArgs,
  text: string,
  notebookUsesIds: boolean,
): NotebookCell {
  const cellType = assertCellType(args.cell_type ?? "code");
  const cell: NotebookCell = {
    cell_type: cellType,
    metadata: {},
    source: text,
  };
  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }
  if (notebookUsesIds) {
    cell.id = randomUUID().slice(0, 8);
  }
  return cell;
}

/**
 * Edits a Jupyter notebook's cells without rewriting the notebook around them.
 * The file is read and written through the workspace helpers, so an editor that
 * owns the buffer (ACP) sees the same change a local file does.
 */
export const notebookEditTool: Tool = {
  name: "NotebookEdit",
  displayName: "Notebook Edit",
  description: `Edit one cell of a Jupyter notebook (.ipynb). Choose replace (default), insert or delete; name the cell by its id or by its 0-based index. A code cell's stale outputs and execution_count are cleared when its source is replaced, and an inserted cell gets an id when the notebook uses them. The rest of the notebook is preserved as-is.`,
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "The .ipynb file to edit",
      },
      edit_mode: {
        type: "string",
        description: "replace (default), insert or delete",
      },
      cell_id: {
        type: "string",
        description: "The id of the target cell",
      },
      cell_index: {
        type: "number",
        description: "The 0-based index of the target cell",
      },
      new_source: {
        type: "string",
        description: "The new cell source for replace or insert",
      },
      cell_type: {
        type: "string",
        description: "code or markdown; defaults to the target cell's type",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => ({
    args,
    preview: [
      {
        type: "text",
        content: `Will ${args?.edit_mode ?? "replace"} a cell in ${String(
          args?.filepath ?? "the notebook",
        )}`,
      },
    ],
  }),
  run: async (args: NotebookEditArgs): Promise<string> => {
    const mode: EditMode = args.edit_mode ?? "replace";
    if (!["replace", "insert", "delete"].includes(mode)) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Unknown notebook edit mode: ${String(args.edit_mode)}.`,
      );
    }
    if (mode !== "delete" && typeof args.new_source !== "string") {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `${mode} needs new_source.`,
      );
    }

    const file = await readWorkspaceTextFile(args.filepath);
    let notebook: Notebook;
    try {
      notebook = JSON.parse(file.content) as Notebook;
    } catch {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `${args.filepath} is not a JSON notebook.`,
      );
    }
    if (!Array.isArray(notebook.cells)) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `${args.filepath} has no cells array.`,
      );
    }

    const notebookUsesIds = notebook.cells.some(
      (cell) => typeof cell.id === "string",
    );
    let summary: string;

    if (mode === "insert") {
      const text = args.new_source as string;
      const cell = newCell(args, text, notebookUsesIds);
      let at = notebook.cells.length;
      if (typeof args.cell_index === "number") {
        if (
          !Number.isInteger(args.cell_index) ||
          args.cell_index < 0 ||
          args.cell_index > notebook.cells.length
        ) {
          throw new ContinueError(
            ContinueErrorReason.Unspecified,
            `Insert index ${args.cell_index} is out of range for ${args.filepath}.`,
          );
        }
        at = args.cell_index;
      } else if (typeof args.cell_id === "string" && args.cell_id !== "") {
        at = locateCell(notebook.cells, args).index + 1;
      }
      notebook.cells.splice(at, 0, cell);
      summary = `Inserted a ${cell.cell_type} cell at index ${at} in ${args.filepath}.`;
    } else {
      const { index, cell } = locateCell(notebook.cells, args);
      if (mode === "delete") {
        notebook.cells.splice(index, 1);
        summary = `Deleted cell ${index} from ${args.filepath}.`;
      } else {
        const text = args.new_source as string;
        const cellType = assertCellType(
          args.cell_type ?? cell.cell_type ?? "code",
        );
        cell.source = sourceValue(text, cell.source);
        cell.cell_type = cellType;
        if (cellType === "code") {
          cell.execution_count = null;
          cell.outputs = [];
        } else {
          delete cell.outputs;
          delete cell.execution_count;
        }
        summary = `Replaced cell ${index} (${cellType}) in ${args.filepath}.`;
      }
    }

    const written = await writeWorkspaceTextFile(
      args.filepath,
      `${JSON.stringify(notebook, null, 2)}\n`,
    );
    markFileAsSeen(written.realPath);
    scheduleFileRefresh(written.realPath);
    return summary;
  },
};
