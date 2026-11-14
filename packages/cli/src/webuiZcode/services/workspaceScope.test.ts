import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFileService } from "@zcode/services/node";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspaceScopedFileService,
  createWorkspaceScopedTerminalService,
  resolveReadableDirectory,
  resolveWithinWorkspace,
  WORKSPACE_BOUNDARY_PREFIX,
  type DisposableTerminalService,
} from "./workspaceScope.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

interface FakeTerminalState {
  createCalls: number;
  lastCwd: string | undefined;
}

function fakeTerminal(): {
  service: DisposableTerminalService;
  state: FakeTerminalState;
} {
  const state: FakeTerminalState = { createCalls: 0, lastCwd: undefined };
  let nextId = 0;
  const idle = { dispose: () => undefined };
  const service: DisposableTerminalService = {
    async create(params) {
      state.createCalls += 1;
      state.lastCwd = params.cwd;
      nextId += 1;
      return {
        id: `pty-${nextId}`,
        shell: "/bin/sh",
        fontFamily: "monospace",
        fontFamilySource: "fallback",
      };
    },
    write: async () => undefined,
    resize: async () => undefined,
    dispose: async () => undefined,
    onDynamicData: () => () => idle,
    onDynamicExit: () => () => idle,
    disposeAll: () => undefined,
  };
  return { service, state };
}

describe("the workspace boundary", () => {
  it("accepts a path inside the workspace, including a not-yet-created file", async () => {
    const workspace = await tempDir("tnt-ws-scope-in-");
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");

    const resolved = await resolveWithinWorkspace(
      workspace,
      path.join(workspace, "alpha.txt"),
      "file path",
    );
    expect(resolved).toBe(await realpathOf(workspace, "alpha.txt"));

    const missing = await resolveWithinWorkspace(
      workspace,
      path.join(workspace, "later", "beta.txt"),
      "file path",
    );
    expect(missing.startsWith(await realpathOf(workspace))).toBe(true);
  });

  it("rejects an absolute path outside the workspace", async () => {
    const workspace = await tempDir("tnt-ws-scope-ws-");
    const outside = await tempDir("tnt-ws-scope-out-");
    await writeFile(path.join(outside, "secret.txt"), "secret\n");
    const fileService = createWorkspaceScopedFileService(
      createFileService(),
      workspace,
    );

    await expect(fileService.readdir({ path: outside })).rejects.toThrow(
      `${WORKSPACE_BOUNDARY_PREFIX}file path`,
    );
    await expect(
      fileService.readTextFile({ path: path.join(outside, "secret.txt") }),
    ).rejects.toThrow(`${WORKSPACE_BOUNDARY_PREFIX}file path`);
  });

  it("allows a directory browser to read a registered workspace's parent", async () => {
    const workspace = await tempDir("tnt-ws-scope-parent-ws-");
    const project = path.join(workspace, "project");
    await mkdir(project, { recursive: true });
    const fileService = createWorkspaceScopedFileService(
      createFileService(),
      project,
    );

    expect(
      await resolveReadableDirectory(project, workspace, "file path"),
    ).toBe(await realpath(workspace));
    await expect(fileService.readdir({ path: workspace })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "project", type: "directory" }),
      ]),
    );
  });

  it("rejects a `..` escape and a symlink that points outside", async () => {
    const workspace = await tempDir("tnt-ws-scope-dotdot-ws-");
    const outside = await tempDir("tnt-ws-scope-dotdot-out-");
    await writeFile(path.join(outside, "secret.txt"), "secret\n");
    const fileService = createWorkspaceScopedFileService(
      createFileService(),
      workspace,
    );

    await expect(
      fileService.readdir({
        path: path.join(workspace, "..", path.basename(outside)),
      }),
    ).rejects.toThrow(WORKSPACE_BOUNDARY_PREFIX);

    const link = path.join(workspace, "escape");
    await symlink(outside, link, "dir");
    await expect(fileService.readdir({ path: link })).rejects.toThrow(
      WORKSPACE_BOUNDARY_PREFIX,
    );
  });

  it("rejects writes whose root points outside the workspace", async () => {
    const workspace = await tempDir("tnt-ws-scope-write-ws-");
    const outside = await tempDir("tnt-ws-scope-write-out-");
    const fileService = createWorkspaceScopedFileService(
      createFileService(),
      workspace,
    );

    await expect(
      fileService.writeWorkspaceFileSearchIgnore({
        rootPath: outside,
        content: "*\n",
      }),
    ).rejects.toThrow(WORKSPACE_BOUNDARY_PREFIX);
  });

  it("falls a terminal cwd outside back to the workspace and defaults a missing cwd to it", async () => {
    const workspace = await tempDir("tnt-ws-scope-term-ws-");
    const outside = await tempDir("tnt-ws-scope-term-out-");
    const terminal = fakeTerminal();
    const service = createWorkspaceScopedTerminalService(
      terminal.service,
      workspace,
    );

    // A cwd the session has not registered must not fail the panel: the
    // terminal degrades to the primary workspace instead of refusing to open.
    const outsideCreated = await service.create({
      cols: 80,
      rows: 24,
      cwd: outside,
    });
    expect(outsideCreated.id).toBe("pty-1");
    expect(terminal.state.lastCwd).toBe(await realpath(workspace));

    const inside = await service.create({
      cols: 80,
      rows: 24,
      cwd: path.join(workspace, "nested"),
    });
    expect(inside.id).toBe("pty-2");
    expect(terminal.state.lastCwd).toBe(
      await resolveWithinWorkspace(
        workspace,
        path.join(workspace, "nested"),
        "terminal cwd",
      ),
    );

    await service.create({ cols: 80, rows: 24 });
    expect(terminal.state.lastCwd).toBe(await realpathOf(workspace));
  });
});

async function realpathOf(
  workspace: string,
  ...segments: string[]
): Promise<string> {
  return path.join(await realpath(workspace), ...segments);
}
