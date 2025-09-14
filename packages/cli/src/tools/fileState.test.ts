import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tools' side effects outside the file itself are not what is under test.
vi.mock("../retrieval/writeRefresh.js", () => ({
  scheduleFileRefresh: vi.fn(),
}));
vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    recordLinesOfCodeModified: vi.fn(),
    logToolResult: vi.fn(),
  },
}));
vi.mock("../telemetry/utils.js", () => ({
  calculateLinesOfCodeDiff: vi.fn(() => ({ added: 1, removed: 0 })),
  getLanguageFromFilePath: vi.fn(() => "typescript"),
}));

import { editTool } from "./edit.js";
import {
  changedSinceSeen,
  forgetSeenFiles,
  hasSeenFile,
  markFileAsSeen,
} from "./fileState.js";
import { multiEditTool } from "./multiEdit.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";

let dir: string;
let target: string;

function writeOnDisk(content: string): void {
  fs.writeFileSync(target, content);
}

async function readWithTool(): Promise<string> {
  return readFileTool.run!({ filepath: target });
}

function editArgs(oldString: string, newString: string) {
  return {
    file_path: target,
    old_string: oldString,
    new_string: newString,
  };
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tnt-seen-")));
  target = path.join(dir, "subject.ts");
  forgetSeenFiles();
});

afterEach(() => {
  forgetSeenFiles();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("read state", () => {
  it("has nothing to compare before the file was seen", () => {
    writeOnDisk("const value = 1;\n");
    expect(hasSeenFile(target)).toBe(false);
    expect(changedSinceSeen(target)).toBe(false);
  });

  it("reports no change for a file left alone", () => {
    writeOnDisk("const value = 1;\n");
    markFileAsSeen(target);
    expect(changedSinceSeen(target)).toBe(false);
  });

  it("reports the change a rewrite outside TNT made", () => {
    writeOnDisk("const value = 1;\n");
    markFileAsSeen(target);
    writeOnDisk("const value = 222;\n");
    expect(changedSinceSeen(target)).toBe(true);
  });

  it("treats a file that disappeared as not what was seen", () => {
    writeOnDisk("const value = 1;\n");
    markFileAsSeen(target);
    fs.rmSync(target);
    expect(changedSinceSeen(target)).toBe(true);
  });
});

describe("Edit against a file that moved", () => {
  it("refuses an edit whose read is no longer current", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();
    writeOnDisk("const value = 222;\n");

    const error = await editTool.preprocess!(
      editArgs("const value = 222;", "const value = 3;"),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ContinueError);
    expect(error.reason).toBe(ContinueErrorReason.EditToolFileNotRead);
    expect(error.message).toContain("changed since you read it");
  });

  it("accepts the edit once the model has read the change", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();
    writeOnDisk("const value = 222;\n");
    await readWithTool();

    const planned = await editTool.preprocess!(
      editArgs("const value = 222;", "const value = 3;"),
    );
    await editTool.run!(planned.args);

    expect(fs.readFileSync(target, "utf-8")).toContain("const value = 3;");
  });

  it("refuses at write time when the file changed while approval was pending", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();
    const planned = await editTool.preprocess!(
      editArgs("const value = 1;", "const value = 3;"),
    );

    // Someone else wins the race between planning and writing.
    writeOnDisk("const value = 222;\n");
    const error = await editTool.run!(planned.args).catch((e) => e);

    expect(error).toBeInstanceOf(ContinueError);
    expect(error.message).toContain("awaiting approval");
    expect(fs.readFileSync(target, "utf-8")).toBe("const value = 222;\n");
  });

  it("does not mistake its own edit for somebody else's", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();

    const first = await editTool.preprocess!(
      editArgs("const value = 1;", "const value = 22;"),
    );
    await editTool.run!(first.args);

    const second = await editTool.preprocess!(
      editArgs("const value = 22;", "const value = 33;"),
    );
    await editTool.run!(second.args);

    expect(fs.readFileSync(target, "utf-8")).toContain("const value = 33;");
  });
});

describe("MultiEdit against a file that moved", () => {
  function multiEditArgs(oldString: string, newString: string) {
    return {
      file_path: target,
      edits: [{ old_string: oldString, new_string: newString }],
    };
  }

  it("refuses at write time when the file changed while approval was pending", async () => {
    writeOnDisk("const value = 1;\nexport const flag = 2;\n");
    await readWithTool();
    const planned = await multiEditTool.preprocess!(
      multiEditArgs("const value = 1;", "const value = 3;"),
    );

    writeOnDisk("const value = 1;\nexport const flag = 222;\n");
    const error = await multiEditTool.run!(planned.args).catch((e) => e);

    expect(error).toBeInstanceOf(ContinueError);
    expect(error.message).toContain("awaiting approval");
    expect(fs.readFileSync(target, "utf-8")).toContain("flag = 222");
  });

  it("does not mistake its own edit for somebody else's", async () => {
    writeOnDisk("const value = 1;\nexport const flag = 2;\n");
    await readWithTool();

    const first = await multiEditTool.preprocess!(
      multiEditArgs("const value = 1;", "const value = 22;"),
    );
    await multiEditTool.run!(first.args);

    const second = await multiEditTool.preprocess!(
      multiEditArgs("export const flag = 2;", "export const flag = 33;"),
    );
    await multiEditTool.run!(second.args);

    expect(fs.readFileSync(target, "utf-8")).toContain("const value = 22;");
    expect(fs.readFileSync(target, "utf-8")).toContain("flag = 33;");
  });
});

describe("Write against a file that moved", () => {
  it("refuses to overwrite a file the model read too many edits ago", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();
    writeOnDisk("const value = 222;\n");

    const error = await writeFileTool.run!({
      filepath: target,
      content: "export const dropped = 1;\n",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ContinueError);
    expect(error.message).toContain("changed since you read it");
    expect(fs.readFileSync(target, "utf-8")).toBe("const value = 222;\n");
  });

  it("still writes a file nobody read through TNT", async () => {
    writeOnDisk("const value = 1;\n");

    await writeFileTool.run!({
      filepath: target,
      content: "export const created = 1;\n",
    });

    expect(fs.readFileSync(target, "utf-8")).toContain("export const created");
  });

  it("counts its own write as the newest thing the model saw", async () => {
    writeOnDisk("const value = 1;\n");
    await readWithTool();

    await writeFileTool.run!({
      filepath: target,
      content: "export const rewritten = 1;\n",
    });

    expect(changedSinceSeen(target)).toBe(false);
  });
});
