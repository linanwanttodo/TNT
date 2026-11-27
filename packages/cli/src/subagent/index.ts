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
      run_in_background: {
        type: "boolean",
        description:
          "Return a run id immediately and let the child work in the background (default true). Set false only when the caller needs the final report before continuing.",
      },
      session_id: {
        type: "string",
        description:
          "Resume a previous child conversation instead of starting a new one.",
      },
      isolation: {
        type: "string",
        enum: ["worktree"],
        description:
          "Run filesystem and shell tools in a temporary git worktree. The worktree is removed when the run ends.",
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
 * Summons the whole active team through its lead.
 *
 * The description is static for the same reason the assignment tool's is: it
 * sits in the cached prompt prefix, so naming the active team or its roster
 * here would rewrite the tool schema whenever the roster changes.
 */
export const SUMMON_TEAM_TOOL_META: Tool = {
  name: "SummonTeam",
  displayName: "Summon Team",
  description:
    "Run a team's lead with a task. A team is the same dispatch mechanism as a subagent at a larger scale: the lead plans the work and dispatches the roster's members, then reports back; this tool returns the lead's report. Use it for work that needs several experts; dispatch a single expert with Subagent instead. You decide whether to give the team a goal, how to run the members (mode), and which members to use. No prior /team activation is needed: name a roster with team, or let the active or only roster be used.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description:
          "Optional. What the whole team should accomplish: the objective, constraints, and anything already ruled out. Omit it when the task is clear from the conversation; you decide whether the team needs a stated goal.",
      },
      team: {
        type: "string",
        description:
          "Optional. Roster name to run, as listed by ListSubagents. Defaults to the active roster, or the only roster when just one is loaded.",
      },
      mode: {
        type: "string",
        enum: ["auto", "parallel", "serial"],
        description:
          "How the lead should run the members. auto lets the lead decide; parallel runs non-overlapping members together; serial runs them one at a time in order. Defaults to auto.",
      },
      members: {
        type: "array",
        items: { type: "string" },
        description:
          "Member names to dispatch, in order. Defaults to every non-lead member of the active team.",
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

export const TASK_OUTPUT_TOOL_META: Tool = {
  name: "TaskOutput",
  displayName: "Task Output",
  description:
    "Read one delegated run's status and final report, or list the parent session's live and persisted child runs.",
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    properties: {
      run_id: { type: "string", description: "Run id returned by Subagent." },
      session_id: { type: "string", description: "Child session id." },
      include_transcript: {
        type: "boolean",
        description: "Include the child transcript's text messages.",
      },
    },
  },
  run: async () => "",
};

export const TASK_STOP_TOOL_META: Tool = {
  name: "TaskStop",
  displayName: "Task Stop",
  description:
    "Stop a running delegated child without stopping the parent turn.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["run_id"],
    properties: {
      run_id: { type: "string", description: "Run id returned by Subagent." },
    },
  },
  run: async () => "",
};

export const SEND_MESSAGE_TOOL_META: Tool = {
  name: "SendMessage",
  displayName: "Send Message",
  description:
    "Send a short steer to a child session, ask the parent for input, or share a brief with the active team. Child-to-parent messages pause the child until the parent replies.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["message"],
    properties: {
      run_id: { type: "string", description: "Target run id." },
      session_id: { type: "string", description: "Target child session id." },
      team_run_id: { type: "string", description: "Target team run id." },
      recipient: {
        type: "string",
        description:
          "Use parent for a child help request, team for a broadcast, or a member name for a direct brief.",
      },
      type: {
        type: "string",
        enum: ["task", "question", "sync", "verdict"],
        description: "Kind of team brief; defaults to sync.",
      },
      message: { type: "string", description: "Short message or brief." },
    },
  },
  run: async () => "",
};
