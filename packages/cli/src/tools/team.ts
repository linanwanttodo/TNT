import type { TeamRunMode } from "core/index.js";

import { t } from "../i18n/index.js";
import { services } from "../services/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import type { ModelServiceState } from "../services/types.js";
import { SERVICE_NAMES } from "../services/types.js";
import {
  beginTeamRun,
  finishTeamRun,
  getSessionActiveTeam,
  MAX_TEAM_RUN_MEMBERS,
} from "../session/index.js";
import { TEAM_RUN_MAX_SUBAGENT_DEPTH } from "../subagent/depth.js";
import { executeSubAgent } from "../subagent/executor.js";
import { SUMMON_TEAM_TOOL_META } from "../subagent/index.js";
import {
  formatSubagentToolResult,
  noteVerificationOutcome,
} from "../subagent/report.js";
import {
  loadTeams,
  type TeamDefinition,
  type TeamMember,
} from "../team/loader.js";

import { resolveAgentState } from "./subagent.js";
import type { Tool } from "./types.js";

const RUN_MODES: readonly TeamRunMode[] = ["auto", "parallel", "serial"];

export interface LeadBriefOptions {
  mode?: TeamRunMode;
  /** The members this run may dispatch; defaults to every non-lead member. */
  members?: readonly TeamMember[];
}

function modeInstruction(mode: TeamRunMode): string {
  switch (mode) {
    case "serial":
      return "Run strategy: serial. Dispatch these members one at a time, in the order listed: do not start a member until the previous member has finished. Declare each member's files scope.";
    case "parallel":
      return "Run strategy: parallel. Dispatch these members together in one batch, one Subagent call per member. Declare each member's files scope so calls with non-overlapping scopes run together; overlapping scopes are serialized.";
    case "auto":
    default:
      return "Run strategy: auto. Decide the order yourself: dispatch independent members together and dependent members in sequence. Declare each member's files scope so the planner can run non-overlapping work together.";
  }
}

/**
 * The brief the lead receives. It carries the goal, the roster the lead is
 * expected to dispatch from, and the strategy the main agent chose, because the
 * lead's own prompt describes its role but not which members this run may use.
 * Descriptions are the roster file's, so a changed roster changes the brief
 * without changing any cached tool schema.
 */
export function composeLeadBrief(
  team: TeamDefinition,
  goal: string,
  options: LeadBriefOptions = {},
): string {
  const scoped =
    options.members ??
    team.members.filter((member) => member.name !== team.lead?.name);
  const allNonLead = team.members.filter(
    (member) => member.name !== team.lead?.name,
  );
  const narrowed = scoped.length < allNonLead.length;

  const roster = scoped
    .map((member) => `- ${member.name}: ${member.description}`)
    .join("\n");

  return [
    `You are the lead of the ${team.name} team.`,
    team.lead?.description ? `Your role: ${team.lead.description}` : "",
    `Goal from the user:\n${goal.trim()}`,
    `Team members in scope for this run (dispatch these with the Subagent tool, by name):\n${roster}`,
    narrowed
      ? "Only these members are in scope for this run; do not dispatch other members."
      : "",
    modeInstruction(options.mode ?? "auto"),
    "Plan the work, dispatch the members the plan needs, and report back with the result: what was done, what verification found, and what still needs a decision. The main agent receives your report.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function failure(message: string): string {
  return formatSubagentToolResult({ success: false, response: message });
}

function resolveActiveTeam(): TeamDefinition | undefined {
  const activeTeamName = getSessionActiveTeam();
  return activeTeamName
    ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
    : undefined;
}

function parseRunMode(raw: unknown): TeamRunMode | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return "auto";
  }
  return RUN_MODES.includes(raw as TeamRunMode)
    ? (raw as TeamRunMode)
    : undefined;
}

type MemberSelection = { members: TeamMember[] } | { error: string };

/**
 * Resolve the requested member names against the roster.
 *
 * Names are kept in the order the caller gave them because serial mode runs
 * "in order". A name that is not a dispatchable member is an error rather than
 * a silent skip: the caller asked for work that cannot happen.
 */
function selectMembers(
  team: TeamDefinition,
  rawMembers: unknown,
): MemberSelection {
  const nonLead = team.members.filter(
    (member) => member.name !== team.lead?.name,
  );

  if (rawMembers === undefined || rawMembers === null) {
    if (nonLead.length === 0) {
      return { error: t("tools.summonTeamNoMembers", { team: team.name }) };
    }
    if (nonLead.length > MAX_TEAM_RUN_MEMBERS) {
      return {
        error: t("tools.summonTeamTooManyMembers", {
          count: nonLead.length,
          max: MAX_TEAM_RUN_MEMBERS,
        }),
      };
    }
    return { members: nonLead };
  }

  if (!Array.isArray(rawMembers)) {
    return { error: t("tools.summonTeamNoMembers", { team: team.name }) };
  }

  const names: string[] = [];
  for (const value of rawMembers) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return { error: t("tools.summonTeamNoMembers", { team: team.name }) };
  }
  if (names.length > MAX_TEAM_RUN_MEMBERS) {
    return {
      error: t("tools.summonTeamTooManyMembers", {
        count: names.length,
        max: MAX_TEAM_RUN_MEMBERS,
      }),
    };
  }

  const members: TeamMember[] = [];
  for (const name of names) {
    const member = nonLead.find((candidate) => candidate.name === name);
    if (!member) {
      return {
        error: t("tools.summonTeamUnknownMember", {
          name,
          team: team.name,
          members:
            nonLead.map((candidate) => candidate.name).join(", ") || "none",
        }),
      };
    }
    members.push(member);
  }

  return { members };
}

/**
 * Runs the active team's lead on a goal, so the main agent can hand the whole
 * team a task in one call instead of relaying between the user and the lead.
 *
 * The lead is dispatched through `executeSubAgent`, exactly like an individual
 * expert: depth, restrictions, permissions, session persistence and model
 * resolution are the dispatch chain's, not a second implementation of them.
 * The lead runs at depth 2's parent (depth 1) because a lead that cannot call
 * Subagent cannot run its team; the run's ledger and the member attribution
 * ride the session, so the workflow view can draw the run without replaying
 * the transcript.
 */
export const summonTeamTool = async (): Promise<Tool> => {
  const modelServiceState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );

  return {
    ...SUMMON_TEAM_TOOL_META,

    run: async (args: any, context?: { toolCallId: string }) => {
      const goal = typeof args?.goal === "string" ? args.goal.trim() : "";
      if (!goal) {
        return failure(t("tools.summonTeamGoalMissing"));
      }

      const mode = parseRunMode(args?.mode);
      if (!mode) {
        return failure(
          t("tools.summonTeamUnknownMode", { mode: String(args?.mode) }),
        );
      }

      const activeTeam = resolveActiveTeam();
      if (!activeTeam) {
        return failure(t("tools.summonTeamNoActiveTeam"));
      }

      const lead = activeTeam.lead;
      if (!lead) {
        return failure(t("tools.summonTeamNoLead", { team: activeTeam.name }));
      }

      const selection = selectMembers(activeTeam, args?.members);
      if ("error" in selection) {
        return failure(selection.error);
      }

      const agent = resolveAgentState(lead.name, modelServiceState, activeTeam);
      if (!agent) {
        return failure(
          t("tools.summonTeamUnresolvedLead", {
            name: lead.name,
            team: activeTeam.name,
          }),
        );
      }

      const parentSessionId = services.chatHistory.getSessionId();
      if (!parentSessionId) {
        return failure(t("tools.noActiveSession"));
      }

      const run = beginTeamRun({
        team: activeTeam.name,
        goal,
        mode,
        members: selection.members.map((member) => member.name),
      });

      let result: Awaited<ReturnType<typeof executeSubAgent>>;
      let succeeded = false;
      try {
        result = await executeSubAgent({
          agent,
          prompt: composeLeadBrief(activeTeam, goal, {
            mode,
            members: selection.members,
          }),
          parentSessionId,
          abortController: new AbortController(),
          maxDelegationDepth: TEAM_RUN_MAX_SUBAGENT_DEPTH,
          onOutputUpdate: context?.toolCallId
            ? (output: string) => {
                try {
                  services.chatHistory.addToolResult(
                    context.toolCallId,
                    output,
                    "calling",
                  );
                } catch {
                  // Ignore errors during streaming updates
                }
              }
            : undefined,
        });
        succeeded = result.success;
      } catch (error: any) {
        return failure(
          t("tools.summonTeamFailed", {
            team: activeTeam.name,
            message: error?.message ?? String(error),
          }),
        );
      } finally {
        finishTeamRun(run.runId, succeeded ? "completed" : "failed");
      }

      if (!result.success) {
        return failure(
          result.error ||
            result.response ||
            t("tools.summonTeamFailed", {
              team: activeTeam.name,
              message: "no report",
            }),
        );
      }

      const unverifiedNudge = noteVerificationOutcome(result.verdict);
      return formatSubagentToolResult(result, unverifiedNudge);
    },
  };
};
