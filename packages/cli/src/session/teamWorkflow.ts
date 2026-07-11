import type {
  ToolCallCreateWorkflowCausalityGraph,
  ToolCallCreateWorkflowDisplay,
} from "@zcode/shared/zcode-protocol-v4";
import type { TeamRunMode } from "core/index.js";

/**
 * The static graph a team run paints on its SummonTeam row.
 *
 * ZCode's workflow view is structural: a lane is an actor, a step is one ask,
 * a participant is that actor in a phase, and a phase is one dispatch wave.
 * Serial waves therefore become one phase each connected by a `phaseEdge`;
 * parallel members share one wave (one phase, several participants) and the
 * absence of an edge is what marks them as simultaneous. The lead is a lane
 * only: the main agent is never drawn as a participant pill.
 *
 * The graph is built before the lead is dispatched, so the tool row paints
 * while members are still running; the live overlay (`workflowRuns`) carries
 * their later state.
 */

/** Stable ids keep the graph independent of member-name length and charset. */
const LEAD_LANE_ID = "main";
const MAX_GRAPH_MEMBERS = 16;
const MAX_LABEL_LENGTH = 128;

export interface TeamWorkflowGraphMember {
  name: string;
  /** The roster description; falls back to the goal head when absent. */
  description?: string;
}

export interface TeamWorkflowGraphInput {
  team: string;
  goal: string;
  mode: TeamRunMode;
  members: readonly TeamWorkflowGraphMember[];
}

/**
 * The wave each member is dispatched in.
 *
 * Serial runs get one wave per member, in the order the caller listed them.
 * Parallel (and `auto`, which the lead may run either way) share the first
 * wave; a single wave has nothing alongside it, so `alongside` and
 * `phaseStreams` stay absent rather than claiming a structure the plan cannot
 * promise.
 */
export function teamRunWaveIds(
  mode: TeamRunMode,
  memberCount: number,
): string[] {
  if (memberCount <= 0) return [];
  if (mode === "serial") {
    return Array.from(
      { length: memberCount },
      (_, index) => `wave-${index + 1}`,
    );
  }
  return Array.from({ length: memberCount }, () => "wave-1");
}

function memberLaneId(index: number): string {
  return `member-${index + 1}`;
}

function stepId(index: number): string {
  return `step-${index + 1}`;
}

function participantId(memberIndex: number, waveId: string): string {
  return `participant-${memberIndex + 1}-${waveId}`;
}

function goalHead(goal: string): string {
  for (const line of goal.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function labelFor(member: TeamWorkflowGraphMember, fallback: string): string {
  const source =
    member.description?.trim() || fallback.trim() || member.name.trim();
  return (
    source.slice(0, MAX_LABEL_LENGTH) || member.name.slice(0, MAX_LABEL_LENGTH)
  );
}

/**
 * Builds the bounded `causalityGraph` payload for a team run. The result is
 * validated by `toolCallCreateWorkflowCausalityGraphSchema`; the schema's own
 * caps (64 steps/lanes/participants, 256 handoffs) are far above a roster.
 */
export function buildTeamWorkflowGraph(
  input: TeamWorkflowGraphInput,
): ToolCallCreateWorkflowCausalityGraph {
  const members = input.members
    .map((member) => ({ ...member, name: member.name.trim() }))
    .filter((member) => member.name.length > 0)
    .slice(0, MAX_GRAPH_MEMBERS);
  const waveIds = teamRunWaveIds(input.mode, members.length);
  const waves = [...new Set(waveIds)];
  const fallback = goalHead(input.goal);

  const lanes: ToolCallCreateWorkflowCausalityGraph["lanes"] = [
    { id: LEAD_LANE_ID },
    ...members.map((member, index) => ({
      id: memberLaneId(index),
      name: member.name.slice(0, MAX_LABEL_LENGTH),
    })),
  ];

  const steps: ToolCallCreateWorkflowCausalityGraph["steps"] = members.map(
    (member, index) => ({
      id: stepId(index),
      kind: "ask",
      label: labelFor(member, fallback),
      lane: memberLaneId(index),
      phase: waveIds[index],
    }),
  );

  const participants: ToolCallCreateWorkflowCausalityGraph["participants"] =
    members.map((_member, index) => ({
      id: participantId(index, waveIds[index]),
      phase: waveIds[index],
      lane: memberLaneId(index),
      steps: [stepId(index)],
      member: { index, of: members.length },
    }));

  // The lead is a lane, not a participant, so these edges name a site the
  // pill layer filters out; they still record the causality the graph is for.
  const handoffs: ToolCallCreateWorkflowCausalityGraph["handoffs"] =
    participants.flatMap((participant) => [
      { from: LEAD_LANE_ID, to: participant.id },
      { from: participant.id, to: LEAD_LANE_ID },
    ]);

  const phases: NonNullable<ToolCallCreateWorkflowCausalityGraph["phases"]> =
    waves.map((wave) => ({ id: wave, name: wave }));

  const phaseEdges =
    input.mode === "serial" && waves.length > 1
      ? waves.slice(1).map((wave, index) => ({
          from: waves[index],
          to: wave,
        }))
      : [];

  return {
    steps,
    lanes,
    participants,
    handoffs,
    phases,
    phaseEdges,
    exits: waves.length > 0 ? [waves[waves.length - 1]] : [],
    sink: ["report"],
  };
}

/**
 * The `create_workflow` display wrapper a SummonTeam tool row carries. `ok` is
 * the run's own outcome: a failed run keeps the graph but marks the card.
 */
export function teamWorkflowDisplay(
  graph: ToolCallCreateWorkflowCausalityGraph,
  ok = true,
): ToolCallCreateWorkflowDisplay {
  return {
    kind: "create_workflow",
    ok,
    errorCount: 0,
    diagnostics: [],
    causalityGraph: graph,
  };
}

const MAX_REMEMBERED_GRAPHS = 40;
const rememberedGraphs = new Map<
  string,
  ToolCallCreateWorkflowCausalityGraph
>();

/**
 * Remembers the graph built with the actual roster descriptions so the
 * app-server can paint the exact payload without re-reading the roster. The
 * ledger is persisted; this cache is not, so a resumed session rebuilds the
 * graph from the ledger (goal-head labels) instead.
 */
export function rememberTeamWorkflowGraph(
  runId: string,
  graph: ToolCallCreateWorkflowCausalityGraph,
): void {
  rememberedGraphs.set(runId, graph);
  while (rememberedGraphs.size > MAX_REMEMBERED_GRAPHS) {
    const oldest = rememberedGraphs.keys().next().value;
    if (oldest === undefined) break;
    rememberedGraphs.delete(oldest);
  }
}

export function teamWorkflowGraphFor(
  runId: string,
): ToolCallCreateWorkflowCausalityGraph | undefined {
  return rememberedGraphs.get(runId);
}

/** Test seam: forget remembered graphs between session fixtures. */
export function clearRememberedTeamWorkflowGraphs(): void {
  rememberedGraphs.clear();
}
