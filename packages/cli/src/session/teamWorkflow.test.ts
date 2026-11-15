import { toolCallCreateWorkflowDisplaySchema } from "@zcode/shared/zcode-protocol-v4";
import { describe, expect, it } from "vitest";

import {
  buildTeamWorkflowGraph,
  teamRunWaveIds,
  teamWorkflowDisplay,
} from "./teamWorkflow.js";

/** The graph schema itself is internal; the display wrapper carries it. */
function expectValidGraph(graph: unknown): void {
  expect(() =>
    toolCallCreateWorkflowDisplaySchema.parse(
      teamWorkflowDisplay(graph as never),
    ),
  ).not.toThrow();
}

const members = [
  { name: "implementer", description: "Writes the feature" },
  { name: "tester", description: "Verifies the feature" },
  { name: "reviewer", description: "Reviews the diff" },
];

describe("buildTeamWorkflowGraph", () => {
  it("draws serial waves as consecutive phases with phase edges", () => {
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Ship the feature",
      mode: "serial",
      members,
    });

    expectValidGraph(graph);
    expect(graph.lanes.map((lane) => lane.id)).toEqual([
      "main",
      "member-1",
      "member-2",
      "member-3",
    ]);
    expect(graph.lanes.slice(1).map((lane) => lane.name)).toEqual([
      "implementer",
      "tester",
      "reviewer",
    ]);
    expect(graph.steps).toHaveLength(3);
    expect(graph.steps.map((step) => step.phase)).toEqual([
      "wave-1",
      "wave-2",
      "wave-3",
    ]);
    expect(graph.steps.map((step) => step.label)).toEqual([
      "Writes the feature",
      "Verifies the feature",
      "Reviews the diff",
    ]);
    expect(graph.phases?.map((phase) => phase.id)).toEqual([
      "wave-1",
      "wave-2",
      "wave-3",
    ]);
    expect(graph.phaseEdges).toEqual([
      { from: "wave-1", to: "wave-2" },
      { from: "wave-2", to: "wave-3" },
    ]);
    expect(graph.participants).toHaveLength(3);
    expect(graph.participants.map((participant) => participant.phase)).toEqual([
      "wave-1",
      "wave-2",
      "wave-3",
    ]);
    expect(graph.participants[0]).toMatchObject({
      lane: "member-1",
      steps: ["step-1"],
      member: { index: 0, of: 3 },
    });
    expect(graph.handoffs).toEqual([
      { from: "main", to: "participant-1-wave-1" },
      { from: "participant-1-wave-1", to: "main" },
      { from: "main", to: "participant-2-wave-2" },
      { from: "participant-2-wave-2", to: "main" },
      { from: "main", to: "participant-3-wave-3" },
      { from: "participant-3-wave-3", to: "main" },
    ]);
    expect(graph.exits).toEqual(["wave-3"]);
    expect(graph.sink).toEqual(["report"]);
  });

  it("puts parallel members in one wave without ordering edges", () => {
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Ship the feature",
      mode: "parallel",
      members,
    });

    expectValidGraph(graph);
    expect(graph.phases).toEqual([{ id: "wave-1", name: "wave-1" }]);
    expect(graph.phaseEdges).toEqual([]);
    expect(graph.participants.map((participant) => participant.phase)).toEqual([
      "wave-1",
      "wave-1",
      "wave-1",
    ]);
    expect(graph.steps.map((step) => step.phase)).toEqual([
      "wave-1",
      "wave-1",
      "wave-1",
    ]);
    expect(graph.exits).toEqual(["wave-1"]);
  });

  it("falls back to the goal head when a member has no description", () => {
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Ship the feature\nwith tests",
      mode: "auto",
      members: [{ name: "implementer" }],
    });

    expect(graph.steps[0]?.label).toBe("Ship the feature");
    expect(graph.phases).toEqual([{ id: "wave-1", name: "wave-1" }]);
  });

  it("produces an empty but valid graph for no members", () => {
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Nothing to do",
      mode: "serial",
      members: [],
    });

    expectValidGraph(graph);
    expect(graph.steps).toEqual([]);
    expect(graph.participants).toEqual([]);
    expect(graph.handoffs).toEqual([]);
    expect(graph.phases).toEqual([]);
    expect(graph.exits).toEqual([]);
    expect(graph.sink).toEqual(["report"]);
    expect(teamRunWaveIds("serial", 0)).toEqual([]);
  });

  it("wraps the graph in a valid create_workflow display", () => {
    const graph = buildTeamWorkflowGraph({
      team: "dev",
      goal: "Ship the feature",
      mode: "parallel",
      members,
    });
    const display = teamWorkflowDisplay(graph, false);

    expect(() =>
      toolCallCreateWorkflowDisplaySchema.parse(display),
    ).not.toThrow();
    expect(display).toMatchObject({
      kind: "create_workflow",
      ok: false,
      errorCount: 0,
      diagnostics: [],
    });
  });
});
