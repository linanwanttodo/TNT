import type { TeamRunRecord } from "core/index.js";
import { describe, expect, it } from "vitest";

import { teamRunsToWorkflowRunSummaries } from "./workflowRunSummaries.js";

function run(overrides: Partial<TeamRunRecord> = {}): TeamRunRecord {
  return {
    runId: "run-1",
    team: "docs",
    goal: "write docs",
    mode: "parallel",
    startedAt: "2026-11-16T01:00:00.000Z",
    status: "running",
    members: [
      {
        name: "writer",
        status: "completed",
        finishedAt: "2026-11-16T01:02:00.000Z",
      },
      {
        name: "editor",
        status: "running",
        startedAt: "2026-11-16T01:01:00.000Z",
      },
      { name: "reviewer", status: "pending" },
    ],
    ...overrides,
  };
}

describe("team run summaries for the Workflow tab", () => {
  it("describes a live run with its roster and goal", () => {
    const [summary] = teamRunsToWorkflowRunSummaries([run()], 10);

    expect(summary?.runId).toBe("run-1");
    expect(summary?.label).toContain("docs: write docs");
    expect(summary?.status).toBe("running");
    expect(summary?.resumable).toBe(false);
    expect(summary?.updatedAt).toBeGreaterThan(0);
  });

  it("marks a failed run as errored and resumable, with the member failure", () => {
    const failed = run({
      status: "failed",
      members: [
        { name: "writer", status: "failed", error: "provider refused" },
      ],
    });
    const [summary] = teamRunsToWorkflowRunSummaries([failed], 10);

    expect(summary?.status).toBe("errored");
    expect(summary?.resumable).toBe(true);
    expect(summary?.failureMessage).toBe("provider refused");
  });

  it("never marks a completed run resumable", () => {
    const finished = run({
      status: "completed",
      members: [{ name: "writer", status: "completed" }],
    });
    const [summary] = teamRunsToWorkflowRunSummaries([finished], 10);

    expect(summary?.status).toBe("completed");
    expect(summary?.resumable).toBe(false);
  });

  it("returns newest first and honours the limit", () => {
    const older = run({ runId: "older" });
    const newer = run({
      runId: "newer",
      startedAt: "2026-11-16T02:00:00.000Z",
      members: [
        {
          name: "writer",
          status: "completed",
          finishedAt: "2026-11-16T03:00:00.000Z",
        },
      ],
    });

    expect(
      teamRunsToWorkflowRunSummaries([older, newer], 10).map((s) => s.runId),
    ).toEqual(["newer", "older"]);
    expect(teamRunsToWorkflowRunSummaries([older, newer], 1)).toHaveLength(1);
  });

  it("stays quiet on an empty ledger", () => {
    expect(teamRunsToWorkflowRunSummaries([], 10)).toEqual([]);
  });
});
