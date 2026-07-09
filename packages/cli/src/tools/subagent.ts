import type { ModelConfig } from "@tnt/config-yaml";

import { createLlmApi } from "../config/index.js";
import { t } from "../i18n/index.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { services } from "../services/index.js";
import { ModelService } from "../services/ModelService.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ModelServiceState, SERVICE_NAMES } from "../services/types.js";
import {
  getSessionActiveTeam,
  getSessionTeamModelOverride,
  getSessionTeamModelOverrides,
} from "../session/index.js";
import { composeSubagentBrief } from "../subagent/brief.js";
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
import {
  formatSubagentToolResult,
  noteVerificationOutcome,
} from "../subagent/report.js";
import { loadTeams, type TeamDefinition } from "../team/loader.js";
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
 *
 * A team member that names a model runs on that model instead. The name is
 * matched the way ModelService.findModelByName matches it (entry name or model
 * id); an unknown name logs and falls back to the session model rather than
 * failing the dispatch. The roster persona stays the base system message, and a
 * configured agent of the same name still shadows the member entirely.
 *
 * Priority for a team member: a session assignment made by AssignTeamModel
 * wins over the roster's `model` field. The assignment is validated when it is
 * written, but the configuration can change under a resumed session, so an
 * unknown assigned name falls back exactly like an unknown roster name.
 */
export function resolveAgentState(
  name: string,
  modelServiceState: ModelServiceState,
  activeTeam?: TeamDefinition,
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
    activeTeam ?? getActiveTeam(),
  );
  if (!dispatchable) {
    return null;
  }

  const override =
    dispatchable.kind === "team"
      ? getSessionTeamModelOverride(name)
      : undefined;
  const requestedModel = override ?? dispatchable.model;
  const assigned = requestedModel
    ? ModelService.findModelByName(modelServiceState, requestedModel)
    : null;
  if (requestedModel && !assigned) {
    logger.warn(
      override
        ? `Team member ${name} is assigned unknown model "${override}": falling back to the session model`
        : `Team member ${name} asks for unknown model "${requestedModel}": falling back to the session model`,
    );
  }

  const inheritFrom = assigned?.model ?? modelServiceState.model;
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
      const { description, files, prompt, subagent_name } = args;

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

      // The dispatch chain already resolved what this member may not do; reuse
      // that answer so the brief states exactly the restrictions in force.
      const dispatchable = resolveDispatchableAgent(
        subagent_name,
        modelServiceState,
        getActiveTeam(),
      );
      const brief = composeSubagentBrief({
        memberName: subagent_name,
        description: typeof description === "string" ? description : undefined,
        prompt: typeof prompt === "string" ? prompt : "",
        restriction: dispatchable?.restriction,
        deniedTools: dispatchable?.deniedTools,
        files: Array.isArray(files)
          ? files.filter((file): file is string => typeof file === "string")
          : undefined,
      });
      logger.debug("subagent brief", {
        agent: subagent_name,
        composed: brief.composed,
        prompt: brief.prompt,
      });

      // Execute subagent with output streaming
      const result = await executeSubAgent({
        agent,
        prompt: brief.prompt,
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

      // A PASS nobody re-ran is a claim, not a verification: the outcome
      // feeds the unverified-streak reminder, and PASS reports carry the
      // spot-check guidance on their tail.
      const unverifiedNudge = noteVerificationOutcome(result.verdict);
      const output = formatSubagentToolResult(result, unverifiedNudge);

      // The composed brief is visible to the caller so it can see exactly what
      // instructions were sent. A structured prompt is already the caller's
      // text, so echoing it back would only duplicate context.
      return brief.composed ? `${output}\n\nBrief:\n${brief.prompt}` : output;
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
        const overrides = getSessionTeamModelOverrides();
        const sessionModelLabel =
          modelServiceState.model?.name ??
          modelServiceState.model?.model ??
          "session default";
        for (const member of activeTeam.members) {
          if (agents.some((agent) => agent.model.name === member.name)) {
            continue;
          }
          const override = overrides?.[member.name];
          const requested = override ?? member.model;
          const resolved = requested
            ? ModelService.findConfiguredModel(modelServiceState, requested)
            : null;
          const modelLabel = resolved
            ? (resolved.name ?? resolved.model)
            : requested
              ? `${sessionModelLabel} (fallback)`
              : sessionModelLabel;
          const assignment = override ? " (assigned)" : "";
          lines.push(
            `- ${member.name}: ${member.description} [model: ${modelLabel}${assignment}]`,
          );
        }
      }

      if (lines.length === 0) {
        return "No subagents are configured.";
      }
      return `Available subagents:\n${lines.join("\n")}`;
    },
  };
};
