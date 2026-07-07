import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTntProjectService } from "./projects.js";

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tnt-project-"));
  cleanups.push(dir);
  return dir;
}

describe("createTntProjectService", () => {
  it("projects the served workspace as the only project", async () => {
    const root = workspace();
    const service = createTntProjectService({
      workspacePath: root,
      fileService: { readdir: async () => [] },
    });

    const projects = await service.readProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: path.basename(root),
      hostId: "local",
      roots: [{ rootPath: path.resolve(root), isPrimary: true }],
      deleted: false,
    });

    const tree = await service.readTree();
    expect(tree.projects).toEqual(projects);
    expect(tree.tasks).toEqual([]);
  });

  it("reads a directory through the scoped file service", async () => {
    const root = workspace();
    const seen: string[] = [];
    const service = createTntProjectService({
      workspacePath: root,
      fileService: {
        readdir: async ({ path: target }) => {
          seen.push(target);
          return [];
        },
      },
    });

    await service.readDirectory();
    await service.readDirectory({ path: path.join(root, "src") });

    expect(seen).toEqual([path.resolve(root), path.join(root, "src")]);
  });

  it("returns the workspace for a new session and rejects catalog writes", async () => {
    const root = workspace();
    const service = createTntProjectService({
      workspacePath: root,
      fileService: { readdir: async () => [] },
    });

    await expect(service.prepareSession()).resolves.toMatchObject({
      workspacePath: path.resolve(root),
      additionalDirectories: [],
    });
    await expect(service.saveProject({ roots: [root] })).rejects.toThrow(
      "ZCODE_UNAVAILABLE",
    );
  });
});
