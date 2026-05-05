import type { ChatHistoryItem } from "core";

import { fireSubagentStart, fireSubagentStop } from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import { services } from "../services/index.js";
import { ModelServiceState } from "../services/types.js";
import { runAgentTurn } from "../session/controller.js";
import { getCurrentSession, saveSubagentSession } from "../session/index.js";
import { getSessionActiveTeam } from "../session/index.js";
import { loadTeams } from "../team/loader.js";
import { escapeEvents } from "../utils/cli.js";
import { logger } from "../utils/logger.js";

import {
  canDelegate,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  delegationDepthOf,
  resolveChildDepth,
} from "./depth.js";
import { resolveDispatchableAgent } from "./get-agents.js";
import { createChildContext, type AgentRunContext } from "./runContext.js";
import { type SubAgentVerdict, parseVerdict } from "./verdict.js";

/**
 * Options for executing a subagent
 */
export interface SubAgentExecutionOptions {
  agent: ModelServiceState;
  prompt: string;
  parentSessionId: string;
  abortController: AbortController;
  onOutputUpdate?: (output: string) => void;
  /**
   * Run context for the parent. When omitted, one is built from the global
   * services, so a caller that has none still works.
   */
  parentContext?: AgentRunContext;
  maxDelegationDepth?: number;
}

/**
 * Result from executing a subagent
 */
export interface SubAgentResult {
  success: boolean;
  response: string;
  error?: string;
  /**
   * Set when the agent's report ends in a verdict line, which is how a
   * delegated check reports its finding without the caller re-reading prose.
   */
  verdict?: SubAgentVerdict;
}

/**
 * Build system message for the agent
 */
async function buildAgentSystemMessage(
  agent: ModelServiceState,
  mode: string,
): Promise<string> {
  const baseMessage = services.systemMessage
    ? await services.systemMessage.getSystemMessage(mode as any)
    : "";

  const agentPrompt = agent.model?.chatOptions?.baseSystemMessage || "";

  // Combine base system message with agent-specific prompt
  if (agentPrompt) {
    return `${baseMessage}\n\n${agentPrompt}`;
  }

  return baseMessage;
}

/**
 * Execute a subagent in a child session
 */

export async function executeSubAgent(
  options: SubAgentExecutionOptions,
): Promise<SubAgentResult> {
  const {
    agent: subAgent,
    prompt,
    abortController,
    onOutputUpdate,
    parentContext,
  } = options;

  try {
    logger.debug("Starting subagent execution", {
      agent: subAgent.model?.name,
    });

    const { model, llmApi } = subAgent;
    if (!model || !llmApi) {
      throw new Error(t("subagent.modelUnavailable"));
    }

    const maxDelegationDepth =
      options.maxDelegationDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH;

    const resolvedParent =
      parentContext ??
      ({
        id: options.parentSessionId,
        parentContext: undefined,
        delegationDepth: delegationDepthOf(getCurrentSession()),
        systemMessage: "",
        permissions: services.toolPermissions.getState().permissions,
        mode: services.toolPermissions.getState().currentMode,
        abortSignal: abortController.signal,
      } satisfies AgentRunContext);

    const childDepth = resolveChildDepth({
      delegationDepth: resolvedParent.delegationDepth,
      maxDelegationDepth,
    });

    const systemMessage = await buildAgentSystemMessage(
      subAgent,
      resolvedParent.mode,
    );

    const agentType = subAgent.model?.name ?? "agent";
    const activeTeamName = getSessionActiveTeam();
    const activeTeam = activeTeamName
      ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
      : undefined;
    const dispatchable = resolveDispatchableAgent(
      agentType,
      subAgent,
      activeTeam,
    );

    const childContext = createChildContext(resolvedParent, {
      id: `${resolvedParent.id}:${childDepth}:${agentType}`,
      delegationDepth: childDepth,
      systemMessage,
      abortSignal: abortController.signal,
      // A built-in role or a team member declares what it may not do; a plain
      // configured agent keeps whatever the session allowed, as it did before
      // this existed.
      restriction: dispatchable?.restriction,
      deniedTools: dispatchable?.deniedTools,
    });

    const agentId = childContext.id;

    await fireSubagentStart(agentId, agentType).catch(() => {});

    const chatHistory = [
      {
        message: {
          role: "user",
          content: prompt,
        },
        contextItems: [],
      },
    ] as ChatHistoryItem[];

    const escapeHandler = () => {
      abortController.abort();
      chatHistory.push({
        message: {
          role: "user",
          content: "Subagent execution was cancelled by the user.",
        },
        contextItems: [],
      });
    };

    escapeEvents.on("user-escape", escapeHandler);

    try {
      let accumulatedOutput = "";

      // Execute the chat stream with child session
      await runAgentTurn({
        chatHistory,
        model,
        llmApi,
        abortController,
        callbacks: {
          onContent: (content: string) => {
            accumulatedOutput += content;
            if (onOutputUpdate) {
              onOutputUpdate(accumulatedOutput);
            }
          },
          onToolResult: (result: string) => {
            // todo: skip tool outputs - show tool names and params
            accumulatedOutput += `\n\n${result}`;
            if (onOutputUpdate) {
              onOutputUpdate(accumulatedOutput);
            }
          },
        },
        runOverrides: {
          systemMessage: childContext.systemMessage,
          isHeadless: true,
          permissions: childContext.permissions,
          canDelegate: canDelegate({
            delegationDepth: childDepth,
            maxDelegationDepth,
          }),
        },
      });

      // The last message (mostly) contains the important output to be submitted back to the main agent
      const lastMessage = chatHistory.at(-1);
      const response =
        typeof lastMessage?.message?.content === "string"
          ? lastMessage.message.content
          : "";

      logger.debug("Subagent execution completed", {
        agent: model?.name,
        responseLength: response.length,
      });

      saveSubagentSession({
        parentSessionId: resolvedParent.id,
        subagentType: agentType,
        history: chatHistory,
      });

      await fireSubagentStop(agentId, agentType, response).catch(() => {});

      return {
        success: true,
        response,
        verdict: parseVerdict(response),
      };
    } finally {
      if (escapeHandler) {
        escapeEvents.removeListener("user-escape", escapeHandler);
      }
    }
  } catch (error: any) {
    logger.error("Subagent execution failed", {
      agent: subAgent.model?.name,
      error: error.message,
    });

    return {
      success: false,
      response: "",
      error: error.message,
    };
  }
}
