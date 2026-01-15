import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readWorkspaceTextFile,
  readWorkspaceTextFileIfExists,
  setWorkspaceFileService,
  writeWorkspaceTextFile,
} from "./workspaceFiles.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-workspace-files-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  setWorkspaceFileService(null);
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace file service", () => {
  it("reads and writes through the installed client without touching disk", async () => {
    const root = tempRoot();
    const file = path.join(root, "virtual.ts");
    const writes: Array<{ path: string; content: string }> = [];
    setWorkspaceFileService({
      readTextFile: vi.fn(async () => "editor buffer"),
      writeTextFile: vi.fn(async (absolutePath, content) => {
        writes.push({ path: absolutePath, content });
      }),
    });

    await expect(readWorkspaceTextFile(file)).resolves.toMatchObject({
      content: "editor buffer",
      client: true,
    });
    await expect(writeWorkspaceTextFile(file, "new text")).resolves.toEqual({
      realPath: file,
      client: true,
    });
    expect(writes).toEqual([{ path: file, content: "new text" }]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("falls back to the local file when the client refuses", async () => {
    const root = tempRoot();
    const file = path.join(root, "local.txt");
    fs.writeFileSync(file, "on disk", "utf-8");
    setWorkspaceFileService({
      readTextFile: vi.fn(async () => {
        throw new Error("not open in the editor");
      }),
      writeTextFile: vi.fn(async () => {
        throw new Error("read-only editor");
      }),
    });

    await expect(readWorkspaceTextFile(file)).resolves.toMatchObject({
      content: "on disk",
      client: false,
    });
    await writeWorkspaceTextFile(file, "written locally");
    expect(fs.readFileSync(file, "utf-8")).toBe("written locally");
  });

  it("returns null for a missing file instead of throwing from the probe", async () => {
    const root = tempRoot();
    await expect(
      readWorkspaceTextFileIfExists(path.join(root, "missing.txt")),
    ).resolves.toBeNull();
  });
});
