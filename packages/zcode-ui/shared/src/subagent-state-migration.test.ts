import { describe, expect, it } from "vitest";

import { importSubagentStateSelections } from "./subagent-state-migration.js";

const SELECTION = { providerId: "zcode", modelId: "glm-4.7" };

/**
 * 内置 agent 名单由宿主决定（TNT 自己命名）；迁移不能把覆盖丢成只剩
 * Explore / general-purpose 两个默认键。
 */
describe("importSubagentStateSelections", () => {
  it("keeps every key of the structured built-in override map", () => {
    const result = importSubagentStateSelections({
      builtInModelSelectionOverrides: {
        Explore: { providerId: "zcode", modelId: "glm-4-air" },
        "tnt-architect": SELECTION,
      },
    });

    expect(result.builtInModelSelectionOverrides["tnt-architect"]).toEqual(SELECTION);
    expect(result.builtInModelSelectionOverrides.Explore).toEqual({
      providerId: "zcode",
      modelId: "glm-4-air",
    });
  });

  it("drops malformed values instead of keeping them", () => {
    const result = importSubagentStateSelections({
      builtInModelSelectionOverrides: {
        "tnt-architect": { providerId: "", modelId: "" },
      },
    });

    expect(result.builtInModelSelectionOverrides).toEqual({});
  });

  it("keeps a TNT-named key from the legacy double map", () => {
    const result = importSubagentStateSelections({
      builtInModelOverrides: {
        Explore: "zcode/glm-4-air",
        "tnt-architect": "zcode/glm-4.7",
      },
      builtInThoughtLevelOverrides: {},
    });

    expect(result.builtInModelSelectionOverrides["tnt-architect"]).toEqual(SELECTION);
    expect(result.builtInModelSelectionOverrides.Explore).toEqual({
      providerId: "zcode",
      modelId: "glm-4-air",
    });
  });
});
