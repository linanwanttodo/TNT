import type { ChatHistoryItem } from "core/index.js";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelServiceState } from "../services/types.js";
import { DEFAULT_TEAMS } from "../team/defaultTeams.js";
import type { TeamDefinition } from "../team/loader.js";

import {
  clearSessionTeamModelOverride,
  getCurrentSession,
  loadSessionById,
  setSessionActiveTeam,
  setSessionTeamModelOverride,
  updateSessionHistory,
} from "./index.js";

const history = [
  {
    message: { role: "user", content: "assign the implementer" },
    contextItems: [],
  },
] as unknown as ChatHistoryItem[];

const modelState = {
  llmApi: null,
  model: { name: "work-model", provider: "openai", model: "gpt-x" },
  assistant: {
    models: [{ name: "cheap-model", provider: "openai", model: "haiku" }],
  },
} as unknown as ModelServiceState;

function devTeam(): TeamDefinition {
  return DEFAULT_TEAMS.find((team) => team.name === "dev")!;
}

afterEach(() => {
  clearSessionTeamModelOverride();
  setSessionActiveTeam(undefined);
});

describe("team model assignments on the session", () => {
  it("survives a reload of the session", () => {
    updateSessionHistory(history);
    const sessionId = getCurrentSession().sessionId;

    setSessionActiveTeam("dev");
    setSessionTeamModelOverride("implementer", "cheap-model", {
      activeTeam: devTeam(),
      modelState,
    });

    const loaded = loadSessionById(sessionId);

    expect(loaded?.activeTeam).toBe("dev");
    expect(loaded?.teamModelOverrides).toEqual({
      implementer: "cheap-model",
    });
  });

  it("persists a clear as an empty map", () => {
    updateSessionHistory(history);
    const sessionId = getCurrentSession().sessionId;

    setSessionTeamModelOverride("implementer", "cheap-model", {
      activeTeam: devTeam(),
      modelState,
    });
    clearSessionTeamModelOverride();

    const loaded = loadSessionById(sessionId);

    expect(loaded?.teamModelOverrides).toEqual({});
  });
});
