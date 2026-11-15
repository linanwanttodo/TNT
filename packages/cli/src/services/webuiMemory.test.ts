import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTntMemoryService } from "./webuiMemory.js";
import { resetWebUiProjectCatalogForTests } from "./webuiProjectCatalog.js";

describe("createTntMemoryService", () => {
  const previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  let globalDir: string;
  let workspace: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-memory-global-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-memory-ws-"));
    process.env.TNT_GLOBAL_DIR = globalDir;
    resetWebUiProjectCatalogForTests();
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

  it("reads and writes the same TNT.md the system prompt injects", async () => {
    const service = createTntMemoryService(workspace);
    await service.saveMemory({
      workspacePath: workspace,
      agentId: "tnt",
      config: { content: "Keep the answer short.", enabled: true },
    });

    const loaded = await service.loadMemory({
      workspacePath: workspace,
      agentId: "tnt",
    });
    expect(loaded.memory).toMatchObject({
      content: "Keep the answer short.",
      enabled: true,
    });
    expect(fs.existsSync(path.join(workspace, ".tnt", "TNT.md"))).toBe(true);
  });

  it("lists project memory files with their real size and time", async () => {
    const service = createTntMemoryService(workspace);
    await service.saveMemory({
      workspacePath: workspace,
      agentId: "tnt",
      config: { content: "# Notes\n\nA decision.\n", enabled: true },
    });

    const summaries = await service.listProjectMemories();
    expect(summaries.length).toBe(1);
    expect(summaries[0].files[0]).toMatchObject({
      name: "TNT.md",
      kind: "index",
    });
    expect(summaries[0].files[0].size).toBeGreaterThan(0);

    const content = await service.readProjectMemoryFile({
      workspaceId: summaries[0].id,
      fileName: "TNT.md",
    });
    expect(content.content).toContain("A decision.");
  });

  it("clears the file and rejects a path outside the memory file", async () => {
    const service = createTntMemoryService(workspace);
    await service.saveMemory({
      workspacePath: workspace,
      agentId: "tnt",
      config: { content: "temporary", enabled: true },
    });
    await service.clearMemory({ workspacePath: workspace, agentId: "tnt" });
    expect(fs.existsSync(path.join(workspace, ".tnt", "TNT.md"))).toBe(false);

    await expect(
      service.readProjectMemoryFile({
        workspaceId: `local:${workspace}`,
        fileName: "../secret.md",
      }),
    ).rejects.toThrow(/only TNT\.md/);
  });
});
