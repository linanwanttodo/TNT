import { ModelService } from "../services/ModelService.js";
import type { ModelServiceState } from "../services/types.js";

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
  return ModelService.getSubagentModels(modelState).map(
    (model) => model.model.name,
  );
}
