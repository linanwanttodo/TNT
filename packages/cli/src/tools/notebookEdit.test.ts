import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { notebookEditTool } from "./notebookEdit.js";

let workspace: string;
let file: string;

function sample() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        id: "a",
        cell_type: "code",
        metadata: {},
        source: ["print(1)\n"],
        outputs: [{ output_type: "stream", text: ["1\n"] }],
        execution_count: 1,
      },
      { id: "b", cell_type: "markdown", metadata: {}, source: "# Title" },
      {
        id: "c",
        cell_type: "code",
        metadata: {},
        source: "x = 2",
        outputs: [],
        execution_count: 2,
      },
    ],
  };
}

function readNotebook() {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(process.cwd(), ".tnt-notebook-"));
  file = path.join(workspace, "notebook.ipynb");
  fs.writeFileSync(file, JSON.stringify(sample()));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("NotebookEdit", () => {
  it("replaces a cell's source, clears stale outputs and keeps the line shape", async () => {
    const result = await notebookEditTool.run!({
      filepath: file,
      cell_index: 0,
      new_source: "print(2)\n",
    });

    const notebook = readNotebook();
    expect(result).toContain("Replaced cell 0 (code)");
    expect(notebook.cells[0].source).toEqual(["print(2)\n"]);
    expect(notebook.cells[0].outputs).toEqual([]);
    expect(notebook.cells[0].execution_count).toBeNull();
    expect(notebook.cells[1].source).toBe("# Title");
  });

  it("finds a cell by id and replaces its type", async () => {
    await notebookEditTool.run!({
      filepath: file,
      cell_id: "b",
      cell_type: "code",
      new_source: "y = 3",
    });

    const cell = readNotebook().cells[1];
    expect(cell.cell_type).toBe("code");
    expect(cell.source).toBe("y = 3");
    expect(cell.outputs).toEqual([]);
    expect(cell.execution_count).toBeNull();
  });

  it("inserts a code cell at an index and gives it an id", async () => {
    await notebookEditTool.run!({
      filepath: file,
      edit_mode: "insert",
      cell_index: 1,
      new_source: "z = 4",
    });

    const notebook = readNotebook();
    expect(notebook.cells).toHaveLength(4);
    expect(notebook.cells[1].source).toBe("z = 4");
    expect(notebook.cells[1].outputs).toEqual([]);
    expect(typeof notebook.cells[1].id).toBe("string");
    expect(notebook.cells[1].id).not.toBe("");
  });

  it("inserts a markdown cell without code-only fields", async () => {
    await notebookEditTool.run!({
      filepath: file,
      edit_mode: "insert",
      cell_index: 2,
      cell_type: "markdown",
      new_source: "## Notes",
    });

    const cell = readNotebook().cells[2];
    expect(cell.cell_type).toBe("markdown");
    expect(cell.outputs).toBeUndefined();
    expect(cell.execution_count).toBeUndefined();
  });

  it("deletes a cell by id", async () => {
    await notebookEditTool.run!({
      filepath: file,
      edit_mode: "delete",
      cell_id: "b",
    });

    const ids = readNotebook().cells.map((cell: { id: string }) => cell.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("refuses a notebook that is not JSON", async () => {
    fs.writeFileSync(file, "not a notebook");

    await expect(
      notebookEditTool.run!({
        filepath: file,
        cell_index: 0,
        new_source: "x",
      }),
    ).rejects.toThrow(/not a JSON notebook/);
  });

  it("refuses a missing selector, an out-of-range index and a missing source", async () => {
    await expect(
      notebookEditTool.run!({ filepath: file, new_source: "x" }),
    ).rejects.toThrow(/needs cell_id or cell_index/);

    await expect(
      notebookEditTool.run!({ filepath: file, cell_index: 9, new_source: "x" }),
    ).rejects.toThrow(/out of range/);

    await expect(
      notebookEditTool.run!({ filepath: file, cell_index: 0 }),
    ).rejects.toThrow(/needs new_source/);
  });

  it("previews the edit", async () => {
    const processed = await notebookEditTool.preprocess!({
      filepath: file,
      cell_index: 0,
      new_source: "x",
    });

    expect(JSON.stringify(processed.preview)).toContain("notebook.ipynb");
  });
});
