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
`;
}

export function getAgentNames(modelState: ModelServiceState): string[] {
  return ModelService.getSubagentModels(modelState).map(
    (model) => model.model.name,
  );
}
