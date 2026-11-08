import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetUserBriefOverride } from "../../../agent/userBriefSettings.js";
import {
  getProjectSettingsPath,
  writeSettingsValue,
} from "../../../config/settingsFiles.js";

import { handleBrief } from "./brief.js";

const history: ChatHistoryItem[] = convertToUnifiedHistory([
  {
    role: "user",
    content:
      "Fix the loader crash in src/parser.ts. It must fall back to defaults and `npm test` must pass.",
  },
]);

vi.mock("../../../config/settingsFiles.js", () => ({
  getProjectSettingsPath: vi.fn(() => "/tmp/project/.tnt/settings.json"),
  readSettingsBoolean: vi.fn(() => undefined),
  writeSettingsValue: vi.fn(),
}));

vi.mock("../../../services/index.js", () => ({
  services: {
    chatHistory: {
      getHistory: vi.fn(() => history),
    },
  },
}));

describe("the /brief toggle", () => {
  beforeEach(() => {
    resetUserBriefOverride();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetUserBriefOverride();
  });

  it("turns the brief on and persists the choice", () => {
    const result = handleBrief(["on"]);

    expect(result.output).toContain("Brief on");
    expect(writeSettingsValue).toHaveBeenCalledWith(
      getProjectSettingsPath(),
      "userBrief",
      true,
    );
  });

  it("turns the brief off and persists the choice", () => {
    const result = handleBrief(["off"]);

    expect(result.output).toContain("Brief off");
    expect(writeSettingsValue).toHaveBeenCalledWith(
      getProjectSettingsPath(),
      "userBrief",
      false,
    );
  });

  it("shows the generated brief on status", () => {
    const result = handleBrief(["status"]);

    expect(result.output).toContain("Brief: on");
    expect(result.output).toContain("Objective:");
    expect(result.output).toContain("src/parser.ts");
    expect(result.output).toContain("Acceptance:");
  });

  it("still shows the brief when the toggle is off", () => {
    handleBrief(["off"]);
    const result = handleBrief([]);

    expect(result.output).toContain("Brief: off");
    expect(result.output).toContain("Objective:");
  });

  it("rejects an unknown option with usage", () => {
    const result = handleBrief(["maybe"]);

    expect(result.output).toContain("/brief on|off|status");
  });
});
