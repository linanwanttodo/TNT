import type { ZCodeSessionEvent } from "@zcode/shared";
import {
  applyWorkflowRunRemoved,
  applyWorkflowRunUpdated,
  conversationDeltaSchema,
  toolCallRowSchema,
  workflowRunsStateSchema,
} from "@zcode/shared/zcode-protocol-v4";
import type { WorkflowRunsState } from "@zcode/shared/zcode-protocol-v4";
import type { Session, TeamRunRecord } from "core/index.js";
import { describe, expect, it } from "vitest";

import { buildTeamWorkflowGraph } from "../session/teamWorkflow.js";

import { deltasForEvent } from "./v4Deltas.js";
import { createFrameSubscription } from "./v4Frames.js";
import {
  buildWorkflowRunDeltas,
  projectTeamRun,
  teamRunsToWorkflowRuns,
} from "./workflowRuns.js";

function member(
  name: string,
  status: TeamRunRecord["members"][number]["status"],
  extra: Partial<TeamRunRecord["members"][number]> = {},
): TeamRunRecord["members"][number] {
  return { name, status, ...extra };
}

function teamRun(overrides: Partial<TeamRunRecord> = {}): TeamRunRecord {
  return {
    runId: "team-1",
    team: "dev",
    goal: "Ship the feature",
    mode: "parallel",
    startedAt: "2026-11-09T00:00:00.000Z",
    status: "running",
    members: [member("implementer", "pending"), member("tester", "pending")],
    ...overrides,
  };
}

const fixtureSession = {
  sessionId: "session-1",
  title: "Fixture",
  workspaceDirectory: "/workspace",
  history: [],
} as unknown as Session;

function sessionEvent(
  seq: number,
  type: string,
  payload: unknown,
): ZCodeSessionEvent {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type,
    payload,
  } as unknown as ZCodeSessionEvent;
}

describe("workflowRuns projection", () => {
  it("projects a completed run into the snapshot schema", () => {
    const run = teamRun({
      status: "completed",
      members: [
        member("implementer", "completed", {
          model: "anthropic/claude-sonnet-4-5",
          subagentSessionId: "child-session-1",
          startedAt: "2026-11-09T00:00:01.000Z",
          finishedAt: "2026-11-09T00:00:05.000Z",
        }),
        member("tester", "completed", {
          model: "openai/gpt-5",
          startedAt: "2026-11-09T00:00:02.000Z",
          finishedAt: "2026-11-09T00:00:06.000Z",
        }),
      ],
    });

    const state = teamRunsToWorkflowRuns([run], 7);
    expect(() => workflowRunsStateSchema.parse(state)).not.toThrow();
    expect(state.revision).toBe(7);
    expect(state.runs).toHaveLength(1);
    const projected = state.runs[0];
    expect(projected).toMatchObject({
      runId: "team-1",
      status: "completed",
      usage: { spentTokens: 0, nodesUsed: 2 },
      phaseNames: ["wave-1"],
      phases: [{ name: "wave-1", rounds: 1 }],
    });
    expect(projected.actors).toEqual([
      {
        siteId: "member-1",
        ordinal: 0,
        name: "implementer",
        model: "anthropic/claude-sonnet-4-5",
        sessionId: "child-session-1",
        status: "completed",
        phaseName: "wave-1",
      },
      {
        siteId: "member-2",
        ordinal: 1,
        name: "tester",
        model: "openai/gpt-5",
        status: "completed",
        phaseName: "wave-1",
      },
    ]);
    expect(projected.nodes.map((node) => node.phase)).toEqual([
      "settled",
      "settled",
    ]);
    expect(projected.nodes.map((node) => node.outcome)).toEqual(["ok", "ok"]);
    expect(projected.nodes.map((node) => node.actorSiteId)).toEqual([
      "member-1",
      "member-2",
    ]);

    // The live overlay joins a node to the static graph by lane id, so every
    // actor/node site must exist in the graph and the human name stays on the
    // actor rather than becoming the join key.
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Ship the feature",
      mode: "parallel",
      members: [{ name: "implementer" }, { name: "tester" }],
    });
    const laneIds = new Set(graph.lanes.map((lane) => lane.id));
    for (const actor of projected.actors) {
      expect(laneIds.has(actor.siteId)).toBe(true);
    }
    for (const node of projected.nodes) {
      const actorSiteId = node.actorSiteId ?? "";
      expect(laneIds.has(actorSiteId)).toBe(true);
      expect(node.actorSiteId).toBe(
        projected.actors[node.actorOrdinal ?? -1]?.siteId,
      );
    }
  });

  it("maps a failed run and its member to an errored run and failed node", () => {
    const run = teamRun({
      status: "failed",
      mode: "serial",
      members: [
        member("implementer", "completed"),
        member("tester", "failed", { error: "tests failed" }),
      ],
    });

    const projected = projectTeamRun(run, 3);
    expect(projected.status).toBe("errored");
    expect(projected.error).toBe("tests failed");
    expect(projected.nodes[1]).toMatchObject({
      phase: "settled",
      outcome: "failed",
      phaseName: "wave-2",
    });
    expect(projected.actors[1]?.status).toBe("completed");
    expect(projected.currentPhase).toBeUndefined();
  });

  it("returns an empty state and no deltas when no team ran", () => {
    expect(teamRunsToWorkflowRuns([], 0)).toEqual({ revision: 0, runs: [] });
    expect(buildWorkflowRunDeltas(undefined, [], 0)).toEqual([]);
  });

  it("keeps only the bounded newest runs", () => {
    const runs = Array.from({ length: 10 }, (_, index) =>
      teamRun({ runId: `team-${index + 1}`, status: "completed" }),
    );

    const state = teamRunsToWorkflowRuns(runs, 1);

    expect(state.runs.map((run) => run.runId)).toEqual([
      "team-3",
      "team-4",
      "team-5",
      "team-6",
      "team-7",
      "team-8",
      "team-9",
      "team-10",
    ]);
  });
});

describe("workflowRun deltas", () => {
  it("emits one update per status change with a monotonic revision", () => {
    let ledger: TeamRunRecord[] = [];
    let revision = 0;
    const allDeltas: ReturnType<typeof buildWorkflowRunDeltas> = [];
    const stage = (next: TeamRunRecord[]) => {
      const candidate = revision + 1;
      const deltas = buildWorkflowRunDeltas(ledger, next, candidate);
      if (deltas.length > 0) revision = candidate;
      ledger = next;
      allDeltas.push(...deltas);
      return deltas;
    };

    const pending = teamRun();
    const started = teamRun({
      members: [
        member("implementer", "running", { model: "cheap-model" }),
        member("tester", "pending"),
      ],
    });
    const halfDone = teamRun({
      members: [
        member("implementer", "completed", { model: "cheap-model" }),
        member("tester", "running", { model: "work-model" }),
      ],
    });
    const completed = teamRun({
      status: "completed",
      members: [
        member("implementer", "completed", { model: "cheap-model" }),
        member("tester", "completed", { model: "work-model" }),
      ],
    });

    expect(stage([pending])).toHaveLength(1);
    expect(stage([started])).toHaveLength(1);
    expect(stage([halfDone])).toHaveLength(1);
    expect(stage([completed])).toHaveLength(1);
    expect(stage([completed])).toEqual([]);

    const revisions = allDeltas.map((delta) =>
      delta.op === "workflowRun.updated" ? delta.revision : -1,
    );
    expect(revisions).toEqual([1, 2, 3, 4]);

    let state: WorkflowRunsState | undefined;
    for (const delta of allDeltas) {
      expect(() => conversationDeltaSchema.parse(delta)).not.toThrow();
      if (delta.op === "workflowRun.updated") {
        state = applyWorkflowRunUpdated(state, delta);
      } else if (delta.op === "workflowRun.removed") {
        state = applyWorkflowRunRemoved(state, delta);
      }
    }

    expect(state).toEqual(teamRunsToWorkflowRuns(ledger, revision));

    const first = allDeltas[0];
    if (first?.op !== "workflowRun.updated") throw new Error("expected update");
    expect(first.actors?.map((actor) => actor.status)).toEqual([
      "waiting",
      "waiting",
    ]);
    expect(first.nodes?.map((node) => node.phase)).toEqual([
      "queued",
      "queued",
    ]);

    const second = allDeltas[1];
    if (second?.op !== "workflowRun.updated")
      throw new Error("expected update");
    expect(second.actors?.[0]).toMatchObject({
      status: "running",
      model: "cheap-model",
    });
    expect(second.nodes?.[0]).toMatchObject({ phase: "executing" });

    const third = allDeltas[2];
    if (third?.op !== "workflowRun.updated") throw new Error("expected update");
    expect(third.nodes?.[0]).toMatchObject({
      phase: "settled",
      outcome: "ok",
    });
    expect(third.nodes?.[1]).toMatchObject({ phase: "executing" });

    const fourth = allDeltas[3];
    if (fourth?.op !== "workflowRun.updated")
      throw new Error("expected update");
    expect(fourth.run?.status).toBe("completed");
    expect(fourth.nodes?.map((node) => node.outcome)).toEqual(["ok", "ok"]);
  });

  it("removes a run that falls out of the window", () => {
    const runs = Array.from({ length: 8 }, (_, index) =>
      teamRun({ runId: `team-${index + 1}`, status: "completed" }),
    );
    const next = [
      ...runs.slice(1),
      teamRun({ runId: "team-9", status: "completed" }),
    ];

    const deltas = buildWorkflowRunDeltas(runs, next, 9);

    expect(deltas).toContainEqual({
      op: "workflowRun.removed",
      runId: "team-1",
      revision: 9,
    });
    expect(
      deltas.filter((delta) => delta.op === "workflowRun.updated"),
    ).toHaveLength(1);
  });
});

describe("workflowRun delta capability", () => {
  const run = teamRun({ status: "completed" });

  it("sends key-level deltas to a subscriber that declared the capability", () => {
    const frame = createFrameSubscription(
      fixtureSession,
      "sub-1",
      "epoch-1",
      true,
    );
    const deltas = deltasForEvent(
      frame,
      sessionEvent(1, "session.updated", {
        workflowRunDeltas: [
          { op: "workflowRun.removed", runId: "team-1", revision: 3 },
        ],
        workflowRuns: teamRunsToWorkflowRuns([run], 3),
      }),
    );

    expect(deltas).toEqual([
      { op: "workflowRun.removed", runId: "team-1", revision: 3 },
    ]);
  });

  it("sends the clamped whole key to a legacy subscriber", () => {
    const frame = createFrameSubscription(
      fixtureSession,
      "sub-1",
      "epoch-1",
      false,
    );
    const whole = teamRunsToWorkflowRuns([run], 3);
    const deltas = deltasForEvent(
      frame,
      sessionEvent(1, "session.updated", {
        workflowRunDeltas: [
          { op: "workflowRun.removed", runId: "team-1", revision: 3 },
        ],
        workflowRuns: whole,
      }),
    );

    expect(deltas).toEqual([
      { op: "state.updated", patch: { workflowRuns: whole } },
    ]);
    expect(() => conversationDeltaSchema.parse(deltas[0])).not.toThrow();
  });
});

describe("SummonTeam display wiring", () => {
  it("attaches the create_workflow graph to a SummonTeam tool row", () => {
    const frame = createFrameSubscription(fixtureSession, "sub-1", "epoch-1");
    const deltas = deltasForEvent(
      frame,
      sessionEvent(1, "tool.updated", {
        kind: "started",
        toolCallId: "call-1",
        toolName: "SummonTeam",
        startedAt: 1_001,
      }),
      { teamRuns: [teamRun()] },
    );

    const row = deltas.find((delta) => delta.op === "row.appended")?.row;
    if (row?.kind !== "toolCall") throw new Error("expected tool row");
    expect(() => toolCallRowSchema.parse(row)).not.toThrow();
    expect(row.display).toMatchObject({
      kind: "create_workflow",
      ok: true,
      errorCount: 0,
      diagnostics: [],
    });
    if (row.display?.kind !== "create_workflow") {
      throw new Error("expected create_workflow display");
    }
    expect(row.display.causalityGraph?.steps).toHaveLength(2);
    expect(row.display.causalityGraph?.phases).toEqual([
      { id: "wave-1", name: "wave-1" },
    ]);
  });

  it("does not attach a graph to other tools", () => {
    const frame = createFrameSubscription(fixtureSession, "sub-1", "epoch-1");
    const deltas = deltasForEvent(
      frame,
      sessionEvent(1, "tool.updated", {
        kind: "started",
        toolCallId: "call-1",
        toolName: "read_file",
        startedAt: 1_001,
      }),
      { teamRuns: [teamRun()] },
    );

    const row = deltas.find((delta) => delta.op === "row.appended")?.row;
    if (row?.kind !== "toolCall") throw new Error("expected tool row");
    expect(row.display).toBeUndefined();
  });

  it("upserts the row display from a team-run change event", () => {
    const frame = createFrameSubscription(fixtureSession, "sub-1", "epoch-1");
    const started = deltasForEvent(
      frame,
      sessionEvent(1, "tool.updated", {
        kind: "started",
        toolCallId: "call-1",
        toolName: "SummonTeam",
        startedAt: 1_001,
      }),
    );
    expect(started).toHaveLength(1);

    const display = {
      kind: "create_workflow" as const,
      ok: true,
      errorCount: 0,
      diagnostics: [],
      causalityGraph: {
        steps: [],
        lanes: [{ id: "main" }],
        participants: [],
        handoffs: [],
        phases: [],
        phaseEdges: [],
        exits: [],
        sink: ["report"],
      },
    };
    const deltas = deltasForEvent(
      frame,
      sessionEvent(2, "session.updated", {
        teamWorkflowDisplay: { toolCallId: "call-1", display },
      }),
    );

    expect(deltas).toHaveLength(1);
    const row = deltas[0];
    if (row?.op !== "row.upserted" || row.row.kind !== "toolCall") {
      throw new Error("expected tool row upsert");
    }
    expect(row.row.display).toEqual(display);
  });
});
