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
      files: {
        type: "array",
        items: { type: "string" },
        description:
          "The paths this agent will read or write. Subagent calls whose file scopes do not overlap may run in parallel; scopes that overlap are serialized. Omit to run exclusively, serialized against every other subagent.",
      },
    },
  },
  run: async () => "",
};

/**
 * Assigns a member of the active team to a configured model for subsequent
 * dispatches.
 *
 * The description is static text rather than a generated listing: it sits in
 * the cached prompt prefix, and the model it names or the team roster changes
 * far more often than the sentence does.
 */
export const ASSIGN_TEAM_MODEL_TOOL_META: Tool = {
  name: "AssignTeamModel",
  displayName: "Assign Team Model",
  description:
    "Set the model a team member runs on for subsequent dispatches. Only works while a team is active: the member must be on that team, and the model must be one of the configured models. The member's persona is unchanged, the assignment lasts for this session (including a resume), and it does not affect work already running.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["member", "model"],
    properties: {
      member: {
        type: "string",
        description:
          "The team member's name, as shown by the agent listing tool.",
      },
      model: {
        type: "string",
        description:
          "The configured model name or model id to run this member on.",
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
