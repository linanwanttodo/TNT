import type { Tool } from "./types.js";

export const TASK_CREATE_TOOL_META: Tool = {
  name: "TaskCreate",
  displayName: "Task Create",
  description:
    "Create a shared team task. Dependencies must name existing task ids; dependent tasks stay blocked until every dependency is completed.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["subject"],
    properties: {
      subject: { type: "string", description: "Short actionable task title." },
      description: {
        type: "string",
        description: "Acceptance details and scope.",
      },
      depends_on: {
        type: "array",
        items: { type: "string" },
        description: "Task ids that must complete first.",
      },
    },
  },
  run: async () => "",
};

export const TASK_LIST_TOOL_META: Tool = {
  name: "TaskList",
  displayName: "Task List",
  description:
    "List the active team's shared tasks, including owner, status and dependency-blocked state.",
  readonly: true,
  isBuiltIn: true,
  parameters: { type: "object", properties: {} },
  run: async () => "",
};

export const TASK_GET_TOOL_META: Tool = {
  name: "TaskGet",
  displayName: "Task Get",
  description: "Read one shared team task by id.",
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["task_id"],
    properties: { task_id: { type: "string", description: "Shared task id." } },
  },
  run: async () => "",
};

export const TASK_UPDATE_TOOL_META: Tool = {
  name: "TaskUpdate",
  displayName: "Task Update",
  description:
    "Claim an unblocked task with in_progress, or mark an owned task completed. A teammate always acts as itself; only the lead may assign another owner.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["task_id", "status"],
    properties: {
      task_id: { type: "string", description: "Shared task id." },
      status: {
        type: "string",
        enum: ["in_progress", "completed"],
        description: "Claim the task or complete it.",
      },
      owner: {
        type: "string",
        description: "Lead-only assignment to a roster member.",
      },
    },
  },
  run: async () => "",
};
