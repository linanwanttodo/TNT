import type { ChatHistoryItem } from "core/index.js";
import { afterEach, describe, expect, it } from "vitest";

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

afterEach(() => {
  clearSessionTeamModelOverride();
  setSessionActiveTeam(undefined);
});

describe("team model assignments on the session", () => {
  it("survives a reload of the session", () => {
    updateSessionHistory(history);
    const sessionId = getCurrentSession().sessionId;

    setSessionActiveTeam("dev");
    setSessionTeamModelOverride("implementer", "cheap-model");

    const loaded = loadSessionById(sessionId);

    expect(loaded?.activeTeam).toBe("dev");
    expect(loaded?.teamModelOverrides).toEqual({
      implementer: "cheap-model",
    });
  });

  it("persists a clear as an empty map", () => {
    updateSessionHistory(history);
    const sessionId = getCurrentSession().sessionId;

    setSessionTeamModelOverride("implementer", "cheap-model");
    clearSessionTeamModelOverride();

    const loaded = loadSessionById(sessionId);

    expect(loaded?.teamModelOverrides).toEqual({});
  });

  it("stores names as given: validation belongs to the tool", () => {
    updateSessionHistory(history);

    // The session setter is deliberately storage-only. An unknown member is
    // the tool's mistake to report, not a reason for the session to import the
    // roster and model services back into the persistence layer.
    setSessionTeamModelOverride("  unknown-member ", " not-a-model ");

    expect(getCurrentSession().teamModelOverrides).toEqual({
      "unknown-member": "not-a-model",
    });
  });
});
