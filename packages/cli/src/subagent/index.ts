import { Tool } from "../tools/types.js";

export const SUBAGENT_TOOL_META: Tool = {
  name: "Subagent",
  displayName: "Subagent",
  description: "Use a subagent to handle a specialized task.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["description", "prompt", "subagent_name"],
    properties: {
      description: {
        type: "string",
        description: "A short description of the task",
      },
      prompt: {
        type: "string",
        description: "The task for the agent to perform",
      },
      subagent_name: {
        type: "string",
        description: "The type of specialized agent to use for this task.",
      },
    },
  },
  run: async () => "",
};

/**
 * Lists the agents available for delegation.
 *
 * This is a separate tool rather than part of the delegation tool's
 * description on purpose. The description sits in the cached prompt prefix, so
 * listing agents there would rewrite the tool schema whenever the
 * configuration changes and invalidate every cached token after it.
 */
export const LIST_SUBAGENTS_TOOL_META: Tool = {
  name: "ListSubagents",
  displayName: "List Subagents",
  description:
    "List the specialized agents available for delegation, with a one-line description of each.",
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    properties: {},
  },
  run: async () => "",
};
