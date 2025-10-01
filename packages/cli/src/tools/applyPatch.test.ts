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
