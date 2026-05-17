import type { ModelConfig } from "@tnt/config-yaml";

import { createLlmApi } from "../config/index.js";
import { t } from "../i18n/index.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { services } from "../services/index.js";
import { ModelService } from "../services/ModelService.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ModelServiceState, SERVICE_NAMES } from "../services/types.js";
import { getSessionActiveTeam } from "../session/index.js";
import { executeSubAgent } from "../subagent/executor.js";
import {
  generateSubagentToolDescription,
  resolveDispatchableAgent,
  getAgentNames as getSubagentNames,
} from "../subagent/get-agents.js";
import {
  LIST_SUBAGENTS_TOOL_META,
  SUBAGENT_TOOL_META,
} from "../subagent/index.js";
import { loadTeams } from "../team/loader.js";
import { logger } from "../utils/logger.js";

import { Tool } from "./types.js";

/**
 * Agents contributed by installed plugins. Failures are swallowed because a
 * broken plugin must not break the agent listing the model depends on.
 */
function getPluginAgents(): {
  name: string;
  description?: string;
  content: string;
}[] {
  try {
    return loadAllPlugins().agents;
  } catch (error) {
    logger.warn("Failed to load plugin agents:", error);
    return [];
  }
}

/**
 * Resolve any dispatchable name to a runnable state.
 *
 * Configured agents come straight from the model service. A team member or a
 * plugin agent was listed but never dispatched: both run on the session's own
 * model, renamed, with the persona the dispatch chain resolved as their base
 * system message - the same inherit pattern ModelService uses for built-ins.
 */
function resolveAgentState(
  name: string,
  modelServiceState: ModelServiceState,
): ModelServiceState | null {
  const configured = ModelService.getSubagentModels(modelServiceState).find(
    (agent) => agent.model.name === name,
  );
  if (configured) {
    return configured;
  }

  const dispatchable = resolveDispatchableAgent(
    name,
    modelServiceState,
    getActiveTeam(),
  );
  if (!dispatchable) {
    return null;
  }

  const inheritFrom = modelServiceState.model;
  if (!inheritFrom || !dispatchable.systemMessage) {
    return null;
  }

  const model: ModelConfig = {
    ...inheritFrom,
    name,
    roles: ["subagent"],
    chatOptions: {
      ...inheritFrom.chatOptions,
      baseSystemMessage: dispatchable.systemMessage,
    },
  };
  return {
    llmApi: createLlmApi(model),
    model,
    assistant: modelServiceState.assistant,
  };
}

function getActiveTeam() {
  const activeTeamName = getSessionActiveTeam();
  return activeTeamName
    ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
    : undefined;
}

export const subagentTool = async (): Promise<Tool> => {
  const modelServiceState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );

  return {
    ...SUBAGENT_TOOL_META,

    description: generateSubagentToolDescription(),

    parameters: {
      ...SUBAGENT_TOOL_META.parameters,
      properties: {
        ...SUBAGENT_TOOL_META.parameters.properties,
        subagent_name: {
          type: "string",
          description:
            "The type of specialized agent to use for this task. Call the agent listing tool to see the available agents.",
        },
      },
    },

    preprocess: async (args: any) => {
      const { description, subagent_name } = args;

      const agent = resolveAgentState(subagent_name, modelServiceState);
      if (!agent) {
        throw new Error(
          t("tools.unknownAgentTypeWithList", {
            name: subagent_name,
            agents: getSubagentNames(modelServiceState).join(", "),
          }),
        );
      }

      return {
        args,
        preview: [
          {
            type: "text",
            content: `Spawning ${agent.model?.name} to: ${description}`,
          },
        ],
      };
    },

    run: async (args: any, context?: { toolCallId: string }) => {
      const { prompt, subagent_name } = args;

      logger.debug("subagent args", { args, context });

      // get agent configuration
      const agent = resolveAgentState(subagent_name, modelServiceState);
      if (!agent) {
        throw new Error(t("tools.unknownAgentType", { name: subagent_name }));
      }

      const chatHistoryService = services.chatHistory;
      const parentSessionId = chatHistoryService.getSessionId();
      if (!parentSessionId) {
        throw new Error(t("tools.noActiveSession"));
      }

      // Execute subagent with output streaming
      const result = await executeSubAgent({
        agent,
        prompt,
        parentSessionId,
        abortController: new AbortController(),
        onOutputUpdate: context?.toolCallId
          ? (output: string) => {
              try {
                chatHistoryService.addToolResult(
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

      logger.debug("subagent result", { result });

      const output = [
        result.response,
        "<task_metadata>",
        `status: ${result.success ? "completed" : "failed"}`,
        ...(result.verdict ? [`verdict: ${result.verdict}`] : []),
        "</task_metadata>",
      ]
        .filter(Boolean)
        .join("\n");

      return output;
    },
  };
};

/**
 * Reports the agents that can be delegated to.
 *
 * Kept out of the delegation tool's description so the cached prompt prefix
 * does not change when the agent configuration does.
 */
export const listSubagentsTool = async (): Promise<Tool> => {
  const modelServiceState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );

  return {
    ...LIST_SUBAGENTS_TOOL_META,
    run: async () => {
      const agents = ModelService.getSubagentModels(modelServiceState);
      const lines = agents.map((agent) => {
        const description =
          agent.model.chatOptions?.baseSystemMessage?.trim().split("\n")[0] ??
          "no description";
        return `- ${agent.model.name}: ${description}`;
      });

      for (const agent of getPluginAgents()) {
        const firstLine = agent.content.trim().split("\n")[0] ?? "";
        lines.push(`- plugin:${agent.name}: ${agent.description ?? firstLine}`);
      }

      const activeTeamName = getSessionActiveTeam();
      const activeTeam = activeTeamName
        ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
        : undefined;
      if (activeTeam) {
        for (const member of activeTeam.members) {
          if (agents.some((agent) => agent.model.name === member.name)) {
            continue;
          }
          lines.push(`- ${member.name}: ${member.description}`);
        }
      }

      if (lines.length === 0) {
        return "No subagents are configured.";
      }
      return `Available subagents:\n${lines.join("\n")}`;
    },
  };
};
