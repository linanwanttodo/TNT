import { t } from "../i18n/index.js";
import { ModelService } from "../services/ModelService.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import type { ModelServiceState } from "../services/types.js";
import {
  getSessionActiveTeam,
  setSessionTeamModelOverride,
} from "../session/index.js";
import { ASSIGN_TEAM_MODEL_TOOL_META } from "../subagent/index.js";
import { loadTeams, type TeamDefinition } from "../team/loader.js";

import { Tool } from "./types.js";

export interface TeamModelAssignmentInput {
  member: unknown;
  model: unknown;
  activeTeam: TeamDefinition | undefined;
  modelState: ModelServiceState;
}

export interface TeamModelAssignment {
  member: string;
  model: string;
}

function configuredModelNames(modelState: ModelServiceState): string[] {
  const names = (modelState.assistant?.models ?? [])
    .filter((model) => !!model)
    .map((model) => model.name || model.model)
    .filter((name): name is string => !!name);
  return [...new Set(names)];
}

/**
 * Validates an assignment before it reaches the session.
 *
 * Validation lives at the tool, not in the session setter: an unknown member
 * or model is a mistake in the assignment call, and admitting it would leave a
 * session that silently ignores what the main agent asked for. The session
 * module stays storage-only, which is also what keeps `session` from importing
 * `services` and `team`.
 */
export function resolveTeamModelAssignment(
  input: TeamModelAssignmentInput,
): TeamModelAssignment {
  const member = typeof input.member === "string" ? input.member.trim() : "";
  if (!member) {
    throw new Error(t("tools.assignTeamModelMemberRequired"));
  }
  const team = input.activeTeam;
  if (!team) {
    throw new Error(t("tools.assignTeamModelNoActiveTeam"));
  }
  if (!team.members.some((candidate) => candidate.name === member)) {
    throw new Error(
      t("tools.assignTeamModelUnknownMember", {
        member,
        team: team.name,
        members: team.members.map((candidate) => candidate.name).join(", "),
      }),
    );
  }

  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) {
    throw new Error(t("tools.assignTeamModelModelRequired", { member }));
  }
  if (!ModelService.findConfiguredModel(input.modelState, model)) {
    const available = configuredModelNames(input.modelState);
    throw new Error(
      available.length > 0
        ? t("tools.assignTeamModelUnknownModel", {
            model,
            models: available.join(", "),
          })
        : t("tools.assignTeamModelNoModels", { model }),
    );
  }

  return { member, model };
}

/**
 * Assign a model to a member of the active team for subsequent dispatches.
 *
 * The write lands in the session's override map, not in the roster file: the
 * main agent is choosing a model for this run, and a roster is shared project
 * configuration that a conversation must not rewrite.
 */
export const assignTeamModelTool = async (): Promise<Tool> => {
  const modelServiceState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );

  return {
    ...ASSIGN_TEAM_MODEL_TOOL_META,

    run: async (args: any) => {
      const activeTeamName = getSessionActiveTeam();
      const activeTeam = activeTeamName
        ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
        : undefined;

      const assignment = resolveTeamModelAssignment({
        member: args?.member,
        model: args?.model,
        activeTeam,
        modelState: modelServiceState,
      });

      setSessionTeamModelOverride(assignment.member, assignment.model);

      return `Assigned model "${assignment.model}" to team member "${assignment.member}" for subsequent dispatches.`;
    },
  };
};
