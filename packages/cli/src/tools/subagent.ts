import { services } from "../services/index.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ModelService } from "../services/ModelService.js";
import { ModelServiceState, SERVICE_NAMES } from "../services/types.js";
import { executeSubAgent } from "../subagent/executor.js";
import {
  generateSubagentToolDescription,
  getSubagent,
  getAgentNames as getSubagentNames,
} from "../subagent/get-agents.js";
import {
  LIST_SUBAGENTS_TOOL_META,
  SUBAGENT_TOOL_META,
} from "../subagent/index.js";
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

      const agent = getSubagent(modelServiceState, subagent_name);
      if (!agent) {
        throw new Error(
          `Unknown agent type: ${subagent_name}. Available agents: ${getSubagentNames(
            modelServiceState,
          ).join(", ")}`,
        );
      }

      return {
        args,
        preview: [
          {
            type: "text",
            content: `Spawning ${agent.model.name} to: ${description}`,
          },
        ],
      };
    },

    run: async (args: any, context?: { toolCallId: string }) => {
      const { prompt, subagent_name } = args;

      logger.debug("subagent args", { args, context });

      // get agent configuration
      const agent = getSubagent(modelServiceState, subagent_name);
      if (!agent) {
        throw new Error(`Unknown agent type: ${subagent_name}`);
      }

      const chatHistoryService = services.chatHistory;
      const parentSessionId = chatHistoryService.getSessionId();
      if (!parentSessionId) {
        throw new Error("No active session found");
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
        lines.push(`- ${agent.name}: ${agent.description ?? firstLine}`);
      }

      if (lines.length === 0) {
        return "No subagents are configured.";
      }
      return `Available subagents:\n${lines.join("\n")}`;
    },
  };
};
