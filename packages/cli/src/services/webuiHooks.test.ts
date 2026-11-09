import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTntHooksService } from "./webuiHooks.js";

describe("createTntHooksService", () => {
  const previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  let globalDir: string;
  let workspace: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hooks-global-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hooks-ws-"));
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

  it("saves command hooks to the file each scope owns and reads them back", async () => {
    const service = createTntHooksService();
    await service.saveHooks({
      workspacePath: workspace,
      hooks: [
        {
          id: "user-hook",
          event: "SessionStart",
          type: "command",
          command: "echo user",
          enabled: true,
          location: { source: "zcode", scope: "user", directoryPath: "" },
        },
        {
          id: "project-hook",
          event: "Stop",
          type: "command",
          command: "echo project",
          matcher: ".*",
          enabled: false,
          location: { source: "zcode", scope: "project", directoryPath: "" },
        },
      ],
    });

    const userFile = JSON.parse(
      fs.readFileSync(path.join(globalDir, "settings.json"), "utf-8"),
    );
    expect(userFile.hooks.SessionStart[0].hooks[0].command).toBe("echo user");

    const projectFile = JSON.parse(
      fs.readFileSync(path.join(workspace, ".tnt", "settings.json"), "utf-8"),
    );
    expect(projectFile.hooks.Stop[0].hooks[0]).toMatchObject({
      command: "echo project",
      enabled: false,
    });

    const loaded = await service.loadHooks({ workspacePath: workspace });
    expect(loaded.hooksEnabled).toBe(true);
    expect(loaded.hooks.map((hook) => hook.command).sort()).toEqual([
      "echo project",
      "echo user",
    ]);
  });

  it("keeps a non-command handler a save never displayed", async () => {
    fs.mkdirSync(path.join(workspace, ".tnt"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, ".tnt", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "*",
              hooks: [
                { type: "prompt", prompt: "Check the result" },
                { type: "command", command: "echo old" },
              ],
            },
          ],
        },
      }),
    );

    const service = createTntHooksService();
    await service.saveHooks({
      workspacePath: workspace,
      hooks: [
        {
          id: "new",
          event: "Stop",
          type: "command",
          command: "echo new",
          enabled: true,
          location: { source: "zcode", scope: "project", directoryPath: "" },
        },
      ],
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(workspace, ".tnt", "settings.json"), "utf-8"),
    );
    const handlers = saved.hooks.Stop.flatMap(
      (group: { hooks: { type: string; command?: string }[] }) => group.hooks,
    );
    expect(
      handlers.some((handler: { type: string }) => handler.type === "prompt"),
    ).toBe(true);
    expect(
      handlers.some(
        (handler: { command?: string }) => handler.command === "echo old",
      ),
    ).toBe(false);
    expect(
      handlers.some(
        (handler: { command?: string }) => handler.command === "echo new",
      ),
    ).toBe(true);
  });

  it("reports the all-hooks switch", async () => {
    fs.writeFileSync(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ disableAllHooks: true }),
    );
    const service = createTntHooksService();
    const loaded = await service.loadHooks({ workspacePath: workspace });
    expect(loaded.hooksEnabled).toBe(false);
  });
});
