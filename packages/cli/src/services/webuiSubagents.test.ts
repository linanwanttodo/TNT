import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findMarkdownAgent,
  loadMarkdownAgents,
  markdownAgentIsEnabled,
} from "../subagent/markdownAgents.js";

import { resetWebUiProjectCatalogForTests } from "./webuiProjectCatalog.js";
import { createTntSubagentsService } from "./webuiSubagents.js";

describe("createTntSubagentsService", () => {
  const previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  let globalDir: string;
  let workspace: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagents-global-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagents-ws-"));
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

  it("lists the engine's built-in agents instead of an empty shell", async () => {
    const service = createTntSubagentsService();
    const result = await service.list({
      workspacePath: workspace,
      provider: "glm",
    });

    expect(result.agents.length).toBeGreaterThanOrEqual(9);
    expect(result.agents.map((agent) => agent.name)).toContain("explore");
    expect(result.capability.userScopeAvailable).toBe(true);
  });

  it("creates, lists, updates and deletes a markdown agent", async () => {
    const service = createTntSubagentsService();
    const created = await service.createAgent({
      config: {
        name: "docs-writer",
        description: "Writes release notes",
        systemPrompt: "You write short release notes.",
      },
      provider: "glm",
      scope: "user",
      workspacePath: workspace,
    });

    const file = path.join(globalDir, "agents", "docs-writer.md");
    expect(fs.existsSync(file)).toBe(true);
    expect(created.agent.enabled).toBe(true);

    let listed = await service.list({
      workspacePath: workspace,
      provider: "glm",
    });
    const agent = listed.agents.find((entry) => entry.name === "docs-writer");
    expect(agent?.source).toBe("user");
    expect(agent?.scope).toBe("user");
    expect(agent?.readOnly).toBe(false);

    await service.updateAgent({
      agentId: created.agent.id,
      config: {
        name: "release-notes",
        description: "Writes release notes",
        systemPrompt: "You write short release notes.",
      },
      oldFilePath: file,
      provider: "glm",
      scope: "user",
      workspacePath: workspace,
    });
    expect(fs.existsSync(file)).toBe(false);
    listed = await service.list({ workspacePath: workspace, provider: "glm" });
    expect(listed.agents.some((entry) => entry.name === "release-notes")).toBe(
      true,
    );

    const renamed = listed.agents.find(
      (entry) => entry.name === "release-notes",
    );
    await service.deleteAgent({
      agentId: renamed?.id as string,
      filePath: renamed?.path as string,
    });
    listed = await service.list({ workspacePath: workspace, provider: "glm" });
    expect(listed.agents.some((entry) => entry.name === "release-notes")).toBe(
      false,
    );
  });

  it("makes the enabled toggle change what dispatch can resolve", async () => {
    const service = createTntSubagentsService();
    const created = await service.createAgent({
      config: {
        name: "toggled",
        description: "",
        systemPrompt: "A toggle test agent.",
      },
      provider: "glm",
      scope: "user",
      workspacePath: workspace,
    });

    await service.setEnabled({ agentId: created.agent.id, enabled: false });
    const file = path.join(globalDir, "agents", "toggled.md");
    const parsed = loadMarkdownAgents(workspace).find(
      (agent) => agent.name === "toggled",
    );
    expect(parsed).toBeDefined();
    expect(markdownAgentIsEnabled(parsed!)).toBe(false);
    expect(findMarkdownAgent("toggled", workspace)).toBeDefined();
    expect(fs.existsSync(file)).toBe(true);
  });
});
