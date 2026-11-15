import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocalCommandFiles } from "../ui/commands/loaders/localCommandLoader.js";

import { createTntCommandsService } from "./webuiCommands.js";

describe("createTntCommandsService", () => {
  const previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  let globalDir: string;
  let workspace: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-commands-global-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-commands-ws-"));
    process.env.TNT_GLOBAL_DIR = globalDir;
  });

  afterEach(() => {
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("writes a project command file that the loader then reads", async () => {
    const service = createTntCommandsService();
    const { command } = await service.writeCommandFile({
      config: {
        name: "release",
        prompt: "Prepare the release notes.",
        description: "Release notes",
      },
      storageLevel: "project",
      workspacePath: workspace,
    });

    expect(command.scope).toBe("project");
    expect(fs.existsSync(command.filePath)).toBe(true);
    expect(command.filePath.startsWith(path.join(workspace, ".tnt"))).toBe(
      true,
    );

    const listed = await service.list({ workspacePath: workspace });
    expect(listed.userCommands.map((entry) => entry.name)).toContain("release");
    expect(listed.capability.userScopeAvailable).toBe(true);
  });

  it("disables a command for the slash-command list without deleting it", async () => {
    const service = createTntCommandsService();
    const { command } = await service.writeCommandFile({
      config: { name: "release", prompt: "Prepare the release notes." },
      storageLevel: "project",
      workspacePath: workspace,
    });

    await service.setCommandEnabled({
      commandId: command.id,
      filePath: command.filePath,
      enabled: false,
    });

    const files = loadLocalCommandFiles(workspace);
    expect(files.find((entry) => entry.name === "release")?.enabled).toBe(
      false,
    );
    expect(fs.existsSync(command.filePath)).toBe(true);
  });

  it("renames and deletes a command", async () => {
    const service = createTntCommandsService();
    const { command } = await service.writeCommandFile({
      config: { name: "release", prompt: "Prepare the release notes." },
      storageLevel: "project",
      workspacePath: workspace,
    });

    const updated = await service.updateCommandFile({
      commandId: command.id,
      config: { name: "ship", prompt: "Ship it." },
      oldFilePath: command.filePath,
      storageLevel: "project",
      workspacePath: workspace,
    });
    expect(updated.command.name).toBe("ship");
    expect(fs.existsSync(command.filePath)).toBe(false);

    await service.deleteCommandFile({
      commandId: updated.command.id,
      filePath: updated.command.filePath,
    });
    expect(fs.existsSync(updated.command.filePath)).toBe(false);
  });
});
