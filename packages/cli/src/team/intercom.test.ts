import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetAgentEventBus,
  subscribeAgentEvents,
} from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";
import {
  beginTeamRun,
  clearSessionTeamRuns,
  getTeamBriefs,
  updateSessionHistory,
} from "../session/index.js";

import { shareTeamBrief } from "./intercom.js";

let events: AgentEvent[];

beforeEach(() => {
  updateSessionHistory([]);
  clearSessionTeamRuns();
  events = [];
  subscribeAgentEvents((event) => events.push(event));
});

afterEach(() => {
  clearSessionTeamRuns();
  resetAgentEventBus();
});

describe("team intercom", () => {
  it("persists and publishes a short member brief", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship",
      mode: "parallel",
      members: ["implementer", "tester"],
    });

    const brief = shareTeamBrief({
      teamRunId: run.runId,
      from: "implementer",
      to: "tester",
      type: "sync",
      content: "Endpoint is ready.",
    });

    expect(brief).toMatchObject({
      from: "implementer",
      to: "tester",
      content: "Endpoint is ready.",
    });
    expect(getTeamBriefs(run.runId)).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "team.brief",
        teamRunId: run.runId,
        from: "implementer",
        to: "tester",
      }),
    ]);
  });
});
