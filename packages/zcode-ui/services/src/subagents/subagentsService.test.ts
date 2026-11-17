import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSubagentStateFile } from "./subagentStorage.js";
import { createSubagentsService } from "./subagentsService.js";

const SELECTION = { providerId: "zcode", modelId: "glm-4.7" };

/**
 * 内置 agent 名单由宿主决定（TNT 自己命名）；覆盖 map 必须保留任意字符串
 * 键，读取路径不能把非默认命名的覆盖静默丢弃。
 */
describe("built-in model selection overrides", () => {
  it("survives a read-modify-write cycle for a TNT-named built-in agent", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagents-"));
    try {
      const service = createSubagentsService({ homeDir });
      await service.setBuiltInModelOverride({
        agentName: "tnt-architect",
        modelSelection: SELECTION,
      });
      // 第二次写入先经过 normalize 读回状态文件；修复前该读取会丢弃
      // TNT 命名的键，写入的文件里就不再有它。
      await service.setBuiltInModelOverride({
        agentName: "Explore",
        modelSelection: { providerId: "zcode", modelId: "glm-4-air" },
      });

      const raw = JSON.parse(
        await fs.promises.readFile(await resolveSubagentStateFile({ homeDir }), "utf-8"),
      ) as { builtInModelSelectionOverrides: Record<string, unknown> };
      expect(raw.builtInModelSelectionOverrides["tnt-architect"]).toEqual(SELECTION);
      expect(raw.builtInModelSelectionOverrides.Explore).toEqual({
        providerId: "zcode",
        modelId: "glm-4-air",
      });
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("maps a default-name override onto the built-in agent from list()", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagents-"));
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-subagents-ws-"));
    try {
      const service = createSubagentsService({ homeDir });
      await service.setBuiltInModelOverride({
        agentName: "Explore",
        modelSelection: SELECTION,
      });

      const result = await service.list({ workspacePath });
      const explore = result.agents.find((agent) => agent.name === "Explore");
      expect(explore?.modelSelectionOverride).toEqual(SELECTION);
      const generalPurpose = result.agents.find(
        (agent) => agent.name === "general-purpose",
      );
      expect(generalPurpose?.modelSelectionOverride).toBeUndefined();
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
