import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../retrieval/writeRefresh.js", () => ({
  scheduleFileRefresh: vi.fn(),
}));

import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";

import { applyPatchTool, parseApplyPatch } from "./applyPatch.js";
import { forgetSeenFiles, markFileAsSeen } from "./fileState.js";
import { setWorkspaceFileService } from "./workspaceFiles.js";
let dir: string;
const previousCwd = process.cwd();

const run = (patch: string): Promise<string> => applyPatchTool.run!({ patch });

function write(relative: string, content: string): void {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf-8");
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tnt-patch-")));
  // The workspace a run belongs to is the directory it was started in, so the
  // fixture chdirs and the patch uses the relative paths a model would write.
  process.chdir(dir);
  vi.mocked(scheduleFileRefresh).mockClear();
  forgetSeenFiles();
});

afterEach(() => {
  setWorkspaceFileService(null);
  process.chdir(previousCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ApplyPatch", () => {
  it("adds, updates and deletes in one call", async () => {
    write("src/old.ts", "const a = 1;\nconst b = 2;\n");
    write("src/gone.ts", "nothing here\n");

    const summary = await run(
      [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export const value = 1;",
        "*** Update File: src/old.ts",
        "@@ const a = 1;",
        "-const a = 1;",
        "+const a = 5;",
        "*** Delete File: src/gone.ts",
        "*** End Patch",
      ].join("\n"),
    );

    expect(read("src/new.ts")).toBe("export const value = 1;\n");
    expect(read("src/old.ts")).toContain("const a = 5;");
    expect(read("src/old.ts")).toContain("const b = 2;");
    expect(fs.existsSync(path.join(dir, "src/gone.ts"))).toBe(false);
    expect(summary).toContain("created");
    expect(summary).toContain("updated");
    expect(summary).toContain("deleted");
  });

  it("writes nothing when one hunk cannot be located", async () => {
    write("src/old.ts", "const a = 1;\n");

    const error = await run(
      [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export const value = 1;",
        "*** Update File: src/old.ts",
        "-const never_there = 9;",
        "+const a = 5;",
        "*** End Patch",
      ].join("\n"),
    ).catch((thrown) => thrown);

    expect(String(error)).toContain("const never_there = 9");
    expect(fs.existsSync(path.join(dir, "src/new.ts"))).toBe(false);
    expect(read("src/old.ts")).toBe("const a = 1;\n");
  });

  it("refuses to overwrite a file an Add names", async () => {
    write("src/there.ts", "keep me\n");

    const error = await run(
      [
        "*** Begin Patch",
        "*** Add File: src/there.ts",
        "+replace me",
        "*** End Patch",
      ].join("\n"),
    ).catch((thrown) => thrown);

    expect(String(error)).toContain("already exists");
    expect(read("src/there.ts")).toBe("keep me\n");
  });

  it("updates the client's buffer and leaves the saved file alone", async () => {
    write("src/client.ts", "disk copy\n");
    const readTextFile = vi.fn(async () => "editor copy\n");
    const writeTextFile = vi.fn(async () => {});
    setWorkspaceFileService({ readTextFile, writeTextFile });

    const summary = await run(
      [
        "*** Begin Patch",
        "*** Update File: src/client.ts",
        "-editor copy",
        "+patched",
        "*** End Patch",
      ].join("\n"),
    );

    const absolute = path.join(dir, "src/client.ts");
    expect(readTextFile).toHaveBeenCalledWith(absolute);
    expect(writeTextFile).toHaveBeenCalledWith(absolute, "patched\n");
    expect(read("src/client.ts")).toBe("disk copy\n");
    expect(summary).toContain("updated");
  });

  it("refuses an Add when the client already holds the file", async () => {
    const writeTextFile = vi.fn(async () => {});
    setWorkspaceFileService({
      readTextFile: vi.fn(async () => "already in the editor\n"),
      writeTextFile,
    });

    const error = await run(
      [
        "*** Begin Patch",
        "*** Add File: src/editor-only.ts",
        "+replacement",
        "*** End Patch",
      ].join("\n"),
    ).catch((thrown) => thrown);

    expect(String(error)).toContain("already exists");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("does not reject a client buffer for a saved file that moved", async () => {
    write("src/moved.ts", "first\n");
    const absolute = path.join(dir, "src/moved.ts");
    markFileAsSeen(absolute);
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(absolute, later, later);

    const writeTextFile = vi.fn(async () => {});
    setWorkspaceFileService({
      readTextFile: vi.fn(async () => "first\n"),
      writeTextFile,
    });

    await run(
      [
        "*** Begin Patch",
        "*** Update File: src/moved.ts",
        "-first",
        "+second",
        "*** End Patch",
      ].join("\n"),
    );

    expect(writeTextFile).toHaveBeenCalledWith(absolute, "second\n");
  });

  it("still deletes through local disk because ACP has no delete request", async () => {
    write("src/local-gone.ts", "remove me\n");
    const writeTextFile = vi.fn(async () => {});
    setWorkspaceFileService({
      readTextFile: vi.fn(async () => "remove me\n"),
      writeTextFile,
    });

    await run(
      [
        "*** Begin Patch",
        "*** Delete File: src/local-gone.ts",
        "*** End Patch",
      ].join("\n"),
    );

    expect(fs.existsSync(path.join(dir, "src/local-gone.ts"))).toBe(false);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("keeps a patch inside the workspace", async () => {
    const error = await run(
      [
        "*** Begin Patch",
        "*** Add File: ../escaped-write-check.ts",
        "+x",
        "*** End Patch",
      ].join("\n"),
    ).catch((thrown) => thrown);

    expect(String(error)).toContain("workspace");
    expect(fs.existsSync(path.join(dir, "..", "escaped-write-check.ts"))).toBe(
      false,
    );
  });

  it("refuses a file that moved since it was read", async () => {
    write("src/old.ts", "const a = 1;\n");
    const target = path.join(dir, "src", "old.ts");
    markFileAsSeen(target);
    write("src/old.ts", "const a = 1;\nconst injected = 2;\n");

    const error = await run(
      [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "-const a = 1;",
        "+const a = 5;",
        "*** End Patch",
      ].join("\n"),
    ).catch((thrown) => thrown);

    expect(String(error)).toContain("changed since it was read");
    expect(read("src/old.ts")).toContain("injected");
  });

  it("appends when a hunk has only added lines", async () => {
    write("src/old.ts", "const a = 1;\n");

    await run(
      [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "+const added = 2;",
        "*** End Patch",
      ].join("\n"),
    );

    expect(read("src/old.ts")).toContain("const added = 2;");
  });

  it("puts every destination in front of the human before anything runs", async () => {
    write("src/old.ts", "const a = 1;\n");
    write("src/gone.ts", "nothing here\n");

    const result = await applyPatchTool.preprocess!({
      patch: [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export const value = 1;",
        "*** Update File: src/old.ts",
        "-const a = 1;",
        "+const a = 5;",
        "*** Delete File: src/gone.ts",
        "*** End Patch",
      ].join("\n"),
    });

    // This text is what an approval is for: a grant that cannot name the
    // destinations is a grant given blind.
    expect(result.preview?.[0]?.content).toBe(
      "Will apply a patch to 3 files: add src/new.ts, update src/old.ts, delete src/gone.ts",
    );
    // The approved arguments are the arguments that run.
    expect(result.args).toEqual({
      patch: expect.stringContaining("*** Begin Patch"),
    });
  });

  it("refuses at the preview rather than asking about a patch that cannot land", async () => {
    await expect(
      applyPatchTool.preprocess!({ patch: "not a patch" }),
    ).rejects.toThrow(/Could not read the patch/);

    await expect(
      applyPatchTool.preprocess!({
        patch: [
          "*** Begin Patch",
          "*** Add File: ../escaped-preview.ts",
          "+x",
          "*** End Patch",
        ].join("\n"),
      }),
    ).rejects.toThrow(/workspace/);

    expect(fs.existsSync(path.join(dir, "..", "escaped-preview.ts"))).toBe(
      false,
    );
  });

  it("gives the index every file the patch touched", async () => {
    write("src/old.ts", "const a = 1;\n");

    await run(
      [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export const value = 1;",
        "*** Update File: src/old.ts",
        "-const a = 1;",
        "+const a = 5;",
        "*** End Patch",
      ].join("\n"),
    );

    const refreshed = vi.mocked(scheduleFileRefresh).mock.calls.flat();
    expect(refreshed).toContain(path.join(dir, "src", "new.ts"));
    expect(refreshed).toContain(path.join(dir, "src", "old.ts"));
  });

  it("refreshes nothing for a patch it refused", async () => {
    write("src/there.ts", "keep me\n");

    await run(
      [
        "*** Begin Patch",
        "*** Add File: src/there.ts",
        "+replace me",
        "*** End Patch",
      ].join("\n"),
    ).catch(() => undefined);

    expect(scheduleFileRefresh).not.toHaveBeenCalled();
  });
});

describe("the patch grammar", () => {
  it("names the marker a patch is missing", () => {
    expect(() => parseApplyPatch("Update File: src/a.ts\n+1")).toThrow(
      /Begin Patch/,
    );
  });

  it("reads every file section the patch names", () => {
    const files = parseApplyPatch(
      [
        "*** Begin Patch",
        "*** Add File: a.ts",
        "+x",
        "*** Delete File: b.ts",
        "*** End Patch",
      ].join("\n"),
    );

    expect(files.map((file) => `${file.kind}:${file.path}`)).toEqual([
      "add:a.ts",
      "delete:b.ts",
    ]);
  });
});
