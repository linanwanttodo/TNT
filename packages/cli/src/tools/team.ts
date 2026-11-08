import { t } from "../i18n/index.js";
import { services } from "../services/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import type { ModelServiceState } from "../services/types.js";
import { SERVICE_NAMES } from "../services/types.js";
import { getSessionActiveTeam } from "../session/index.js";
import { executeSubAgent } from "../subagent/executor.js";
import { SUMMON_TEAM_TOOL_META } from "../subagent/index.js";
import {
  formatSubagentToolResult,
  noteVerificationOutcome,
} from "../subagent/report.js";
import { loadTeams, type TeamDefinition } from "../team/loader.js";

import { resolveAgentState } from "./subagent.js";
import type { Tool } from "./types.js";

/**
 * The brief the lead receives. It carries the goal and the roster the lead is
 * expected to dispatch from, because the lead's own prompt describes its role
 * but not which members this session can use. Descriptions are the roster
 * file's, so a changed roster changes the brief without changing any cached
 * tool schema.
 */
export function composeLeadBrief(team: TeamDefinition, goal: string): string {
  const roster = team.members
    .filter((member) => member.name !== team.lead?.name)
    .map((member) => `- ${member.name}: ${member.description}`)
    .join("\n");

  return [
    `You are the lead of the ${team.name} team.`,
    team.lead?.description ? `Your role: ${team.lead.description}` : "",
    `Goal from the user:\n${goal.trim()}`,
    `Team roster (dispatch these members with the Subagent tool, by name):\n${roster}`,
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

/**
 * Runs the active team's lead on a goal, so the main agent can hand the whole
 * team a task in one call instead of relaying between the user and the lead.
 *
 * The lead is dispatched through `executeSubAgent`, exactly like an individual
 * expert: depth, restrictions, permissions, session persistence and model
 * resolution are the dispatch chain's, not a second implementation of them.
 * The lead remains the planner; this tool only carries the goal and the
 * roster to it and returns its report.
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

      const activeTeam = resolveActiveTeam();
      if (!activeTeam) {
        return failure(t("tools.summonTeamNoActiveTeam"));
      }

      const lead = activeTeam.lead;
      if (!lead) {
        return failure(t("tools.summonTeamNoLead", { team: activeTeam.name }));
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

      let result: Awaited<ReturnType<typeof executeSubAgent>>;
      try {
        result = await executeSubAgent({
          agent,
          prompt: composeLeadBrief(activeTeam, goal),
          parentSessionId,
          abortController: new AbortController(),
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
      } catch (error: any) {
        return failure(
          t("tools.summonTeamFailed", {
            team: activeTeam.name,
            message: error?.message ?? String(error),
          }),
        );
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
