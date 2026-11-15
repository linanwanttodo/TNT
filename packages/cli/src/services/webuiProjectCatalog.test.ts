import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWebUiProjectCatalog,
  MAX_WEBUI_PROJECTS,
} from "./webuiProjectCatalog.js";

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tnt-project-catalog-"));
  cleanups.push(dir);
  return dir;
}

function projectPath(root: string, name: string): string {
  return path.join(root, name);
}

describe("createWebUiProjectCatalog", () => {
  it("persists and reloads names, order, pin, deletion and mode", () => {
    const root = tempDir();
    const file = path.join(root, "state", "webui-projects.json");
    const catalog = createWebUiProjectCatalog(file);

    const first = catalog.ensure(projectPath(root, "first"), { name: "First" });
    const second = catalog.ensure(projectPath(root, "second"));
    catalog.update(first.id, { pinned: true, updatedAt: 1234 });
    catalog.update(second.id, { deleted: true });
    catalog.reorder([second.id, first.id]);

    // The 0600 mode is a POSIX guarantee; Windows derives st_mode from the
    // read-only bit and ignores chmod's group/other bits, so it reports 0o666
    // for any writable file regardless of this code.
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(
      readdirSync(path.dirname(file)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);

    const reloaded = createWebUiProjectCatalog(file);
    const records = reloaded.all();
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    expect(records.find((record) => record.id === first.id)).toMatchObject({
      name: "First",
      pinned: true,
      deleted: false,
      path: projectPath(root, "first"),
      updatedAt: 1234,
    });
    expect(records.find((record) => record.id === second.id)).toMatchObject({
      deleted: true,
    });
  });

  it("drops relative, duplicate and malformed entries at load time", () => {
    const root = tempDir();
    const file = path.join(root, "webui-projects.json");
    const valid = projectPath(root, "valid");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        projects: [
          { path: "relative/path", name: "Nope" },
          { path: 42, name: "Nope" },
          { path: valid, name: "  Bad\u0000Name  " },
          { path: valid, name: "Duplicate" },
          { path: path.join(root, "missing"), name: "" },
        ],
      }),
      { mode: 0o600 },
    );

    const records = createWebUiProjectCatalog(file).all();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      path: valid,
      name: "Bad Name",
    });
    expect(records[1]?.name).toBe("missing");
    expect(records.every((record) => path.isAbsolute(record.path))).toBe(true);
  });

  it("survives a malformed file without throwing", () => {
    const root = tempDir();
    const file = path.join(root, "webui-projects.json");
    writeFileSync(file, "{not json", { mode: 0o600 });

    expect(createWebUiProjectCatalog(file).all()).toEqual([]);
  });

  it("bounds the number of stored projects", () => {
    const root = tempDir();
    const catalog = createWebUiProjectCatalog(
      path.join(root, "webui-projects.json"),
    );

    for (let index = 0; index < MAX_WEBUI_PROJECTS + 5; index++) {
      catalog.ensure(projectPath(root, `project-${index}`));
    }

    expect(catalog.all()).toHaveLength(MAX_WEBUI_PROJECTS);
  });
});
