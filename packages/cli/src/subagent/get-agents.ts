import type { PluginAgents } from "../plugins/loader.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { ModelService } from "../services/ModelService.js";
import type { ModelServiceState } from "../services/types.js";
import type { TeamDefinition } from "../team/loader.js";
import { logger } from "../utils/logger.js";

import { isSubagentEnabled, subagentStateKey } from "./agentState.js";
import { builtInAgentByName } from "./builtInAgents.js";
import {
  findMarkdownAgent,
  loadMarkdownAgents,
  markdownAgentIsEnabled,
} from "./markdownAgents.js";

/**
 * Get an agent by name
 */
export function getSubagent(modelState: ModelServiceState, name: string) {
  return (
    ModelService.getSubagentModels(modelState).find(
      (model) => model.model.name === name,
    ) ?? null
  );
}

/**
 * One dispatchable agent resolved to a uniform shape, whatever layer it came
 * from. `restriction`/`deniedTools` are the run-time narrowing the executor
 * applies to the child context; a configured model agent has none, exactly as
 * before.
 */
export interface DispatchableAgent {
  systemMessage: string;
  restriction?: "readonly" | "no-writes";
  deniedTools?: string[];
  /**
   * The model the roster assigned this member, still unresolved: dispatch
   * resolves it against the configured models and falls back to the session
   * model when it names nothing there.
   */
  model?: string;
  kind: "model" | "team" | "plugin" | "markdown";
}

function pluginAgentByName(name: string): PluginAgents | undefined {
  let agents: PluginAgents[];
  try {
    agents = loadAllPlugins().agents;
  } catch (error) {
    logger.warn("Failed to load plugin agents:", error);
    return undefined;
  }
  return agents.find((agent) => agent.name === name);
}

/**
 * Resolve any name the dispatch chain can run, in one place.
 *
 * Lookup order: ModelService (configured agents and built-in roles, where a
 * configured entry wins its name) → an active team's members → a plugin agent
 * under its `plugin:name`. Plugin agents were listed for turns before this
 * existed but could never be dispatched; they run restricted to no-writes
 * because nothing in their provenance vouches for what they may do.
 */
export function resolveDispatchableAgent(
  name: string,
  modelState: ModelServiceState,
  activeTeam?: TeamDefinition,
): DispatchableAgent | null {
  const configured = getSubagent(modelState, name);
  if (configured) {
    // Built-in roles run through ModelService as synthesized model entries,
    // but their narrowing lives in the registry, not on the entry; the
    // executor used to re-look it up by name, and this carries it instead.
    const builtIn = builtInAgentByName(name);
    if (
      builtIn &&
      !isSubagentEnabled(subagentStateKey("builtin", builtIn.name))
    ) {
      return null;
    }
    return {
      systemMessage: configured.model.chatOptions?.baseSystemMessage ?? "",
      restriction: builtIn?.restriction,
      deniedTools: builtIn?.deniedTools ? [...builtIn.deniedTools] : undefined,
      kind: "model",
    };
  }

  // A markdown agent is a file the operator owns; it sits between configured
  // agents and team members so a project-level document can be delegated to
  // by name without a config entry.
  const markdownAgent = findMarkdownAgent(name);
  if (markdownAgent) {
    if (!markdownAgentIsEnabled(markdownAgent)) {
      return null;
    }
    return {
      systemMessage: markdownAgent.systemMessage,
      deniedTools: markdownAgent.disallowedTools
        ? [...markdownAgent.disallowedTools]
        : undefined,
      model: markdownAgent.model,
      kind: "markdown",
    };
  }

  const member = activeTeam?.members.find((m) => m.name === name);
  if (member) {
    const builtIn = member.builtInRef
      ? builtInAgentByName(member.builtInRef)
      : undefined;
    return {
      systemMessage: builtIn ? builtIn.systemMessage : member.systemMessage,
      restriction: builtIn?.restriction ?? member.restriction,
      deniedTools: builtIn?.deniedTools
        ? [...builtIn.deniedTools]
        : member.deniedTools,
      model: member.model,
      kind: "team",
    };
  }

  if (name.startsWith("plugin:")) {
    // The listing tool shows plugin agents under their "plugin:"-prefixed
    // dispatch name; the loader stores them by bare "plugin:file" name.
    const pluginAgent = pluginAgentByName(name.slice("plugin:".length));
    if (
      pluginAgent &&
      !isSubagentEnabled(subagentStateKey("plugin", pluginAgent.name))
    ) {
      return null;
    }
    if (pluginAgent) {
      return {
        systemMessage: pluginAgent.content,
        restriction: "no-writes",
        kind: "plugin",
      };
    }
  }

  return null;
}

/**
 * Generate the tool description.
 *
 * The available agents are deliberately not listed here. This string is part
 * of the cached prompt prefix, so interpolating the agent list into it means a
 * configuration change rewrites the tool schema and invalidates every cached
 * token after it. A model that needs the list calls the separate listing tool
 * instead, which keeps the prefix stable.
 */
export function generateSubagentToolDescription(): string {
  return `Launch a specialized subagent to handle a specific task.

Call the agent listing tool to discover which agents are available before
choosing one.

WRITE THE PROMPT LIKE A BRIEF FOR A COLLEAGUE WHO JUST WALKED IN. They have not
seen this conversation, so state what is being accomplished, what has already been
tried or ruled out, and the file paths and line numbers involved.
Never delegate understanding. "Based on your findings, fix it" is not a brief: say
what to change and where, in the same detail you would write yourself.
Do not delegate a lookup. If you know which file or symbol you want, read it with
Read or Search yourself - a subagent costs a whole run to do one lookup.
While one is working, do not repeat its search. Wait for its report and use it;
duplicated work costs the context both of you are sharing.
`;
}

export function getAgentNames(modelState: ModelServiceState): string[] {
  const configured = ModelService.getSubagentModels(modelState).map(
    (model) => model.model.name,
  );
  const declared = new Set(configured.map((name) => name.toLowerCase()));
  const markdown = loadMarkdownAgents()
    .filter(
      (agent) =>
        !declared.has(agent.name.toLowerCase()) &&
        markdownAgentIsEnabled(agent),
    )
    .map((agent) => agent.name);
  return [...configured, ...markdown];
}
