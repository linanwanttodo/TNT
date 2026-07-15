import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginTeamRun,
  clearSessionTeamRuns,
  finishTeamMemberRun,
  finishTeamRun,
  getCurrentSession,
  getCurrentTeamRunId,
  getSessionTeamRuns,
  loadSessionById,
  MAX_TEAM_RUNS,
  startTeamMemberRun,
  updateSessionHistory,
} from "./index.js";

const history = [
  {
    message: { role: "user", content: "run the dev team" },
    contextItems: [],
  },
] as unknown as ChatHistoryItem[];

beforeEach(() => {
  updateSessionHistory(history);
  clearSessionTeamRuns();
});

afterEach(() => {
  clearSessionTeamRuns();
});

describe("the team-run ledger", () => {
  it("creates a bounded run with the chosen mode and members", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "parallel",
      members: ["implementer", "tester"],
    });

    const [stored] = getSessionTeamRuns();
    expect(stored).toMatchObject({
      runId: run.runId,
      team: "dev",
      goal: "ship the feature",
      mode: "parallel",
      status: "running",
      members: [
        { name: "implementer", status: "pending" },
        { name: "tester", status: "pending" },
      ],
    });
    expect(getCurrentTeamRunId()).toBe(run.runId);
  });

  it("attributes a member's model, session and outcome, then settles the run", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "serial",
      members: ["implementer", "tester"],
    });

    startTeamMemberRun(run.runId, "implementer", "cheap-model");
    finishTeamMemberRun(run.runId, "implementer", {
      success: true,
      subagentSessionId: "child-session",
    });
    startTeamMemberRun(run.runId, "tester", "work-model");
    finishTeamMemberRun(run.runId, "tester", {
      success: false,
      error: "tests failed",
    });
    finishTeamRun(run.runId, "failed");

    const [stored] = getSessionTeamRuns();
    expect(stored.status).toBe("failed");
    expect(stored.members[0]).toMatchObject({
      name: "implementer",
      model: "cheap-model",
      subagentSessionId: "child-session",
      status: "completed",
    });
    expect(stored.members[0].startedAt).toBeTruthy();
    expect(stored.members[0].finishedAt).toBeTruthy();
    expect(stored.members[1]).toMatchObject({
      name: "tester",
      model: "work-model",
      status: "failed",
      error: "tests failed",
    });
    expect(getCurrentTeamRunId()).toBeUndefined();
  });

  it("records the scheduler concurrency the run was planned with", () => {
    const serial = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "serial",
      members: ["implementer", "tester"],
    });
    expect(serial.concurrency).toBe(1);
    finishTeamRun(serial.runId, "completed");

    const parallel = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "parallel",
      members: ["implementer", "tester"],
    });
    expect(parallel.concurrency).toBe(2);
    finishTeamRun(parallel.runId, "completed");

    const auto = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "auto",
      members: ["implementer", "tester"],
    });
    expect(auto.concurrency).toBeUndefined();
    finishTeamRun(auto.runId, "completed");
  });

  it("keeps a successful member's report and drops it on failure", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "serial",
      members: ["implementer", "tester"],
    });

    startTeamMemberRun(run.runId, "implementer");
    finishTeamMemberRun(run.runId, "implementer", {
      success: true,
      subagentSessionId: "child-session",
      report: "implemented and tested",
    });
    startTeamMemberRun(run.runId, "tester");
    finishTeamMemberRun(run.runId, "tester", {
      success: false,
      error: "tests failed",
    });

    const [stored] = getSessionTeamRuns();
    expect(stored.members[0]).toMatchObject({
      name: "implementer",
      status: "completed",
      report: "implemented and tested",
    });
    expect(stored.members[1]).toMatchObject({
      name: "tester",
      status: "failed",
      error: "tests failed",
    });
    expect(stored.members[1].report).toBeUndefined();
  });

  it("survives a reload of the session", () => {
    const sessionId = getCurrentSession().sessionId;
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "auto",
      members: ["implementer"],
    });
    startTeamMemberRun(run.runId, "implementer", "cheap-model");
    finishTeamMemberRun(run.runId, "implementer", {
      success: true,
      subagentSessionId: "child-session",
    });
    finishTeamRun(run.runId, "completed");

    const loaded = loadSessionById(sessionId);

    expect(loaded?.teamRuns).toEqual([
      expect.objectContaining({
        runId: run.runId,
        team: "dev",
        goal: "ship the feature",
        mode: "auto",
        status: "completed",
        members: [
          expect.objectContaining({
            name: "implementer",
            model: "cheap-model",
            subagentSessionId: "child-session",
            status: "completed",
          }),
        ],
      }),
    ]);
  });

  it("keeps only the newest runs", () => {
    for (let index = 0; index < MAX_TEAM_RUNS + 3; index += 1) {
      const run = beginTeamRun({
        team: "dev",
        goal: `goal ${index}`,
        mode: "auto",
        members: ["implementer"],
      });
      finishTeamRun(run.runId, "completed");
    }

    const runs = getSessionTeamRuns();
    expect(runs).toHaveLength(MAX_TEAM_RUNS);
    expect(runs[0].goal).toBe("goal 3");
    expect(runs.at(-1)?.goal).toBe(`goal ${MAX_TEAM_RUNS + 2}`);
  });

  it("marks a cancelled member as cancelled, not failed", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "serial",
      members: ["implementer"],
    });

    startTeamMemberRun(run.runId, "implementer");
    finishTeamMemberRun(run.runId, "implementer", {
      success: false,
      cancelled: true,
      subagentSessionId: "child-session",
      error: "Subagent execution was cancelled by the user.",
    });

    const [stored] = getSessionTeamRuns();
    expect(stored.members[0]).toMatchObject({
      name: "implementer",
      status: "cancelled",
      subagentSessionId: "child-session",
    });
  });

  it("does not attribute a run that has already been settled", () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship the feature",
      mode: "auto",
      members: ["implementer"],
    });
    finishTeamRun(run.runId, "completed");

    startTeamMemberRun(run.runId, "implementer", "late-model");

    expect(getSessionTeamRuns()[0].members[0].status).toBe("pending");
  });
});
