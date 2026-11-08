import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import type { ModelServiceState } from "../services/types.js";
import {
  getSessionActiveTeam,
  setSessionTeamModelOverride,
} from "../session/index.js";
import { ASSIGN_TEAM_MODEL_TOOL_META } from "../subagent/index.js";
import { loadTeams } from "../team/loader.js";

import { Tool } from "./types.js";

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
      const member = args?.member;
      const model = args?.model;

      const activeTeamName = getSessionActiveTeam();
      const activeTeam = activeTeamName
        ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
        : undefined;

      setSessionTeamModelOverride(member, model, {
        activeTeam,
        modelState: modelServiceState,
      });

      return `Assigned model "${String(model).trim()}" to team member "${String(
        member,
      ).trim()}" for subsequent dispatches.`;
    },
  };
};
