import { randomUUID } from "node:crypto";

import { fireTaskCompleted, fireTaskCreated } from "../hooks/fireHook.js";
import {
  claimTeamTask,
  completeTeamTask,
  createTeamTask,
  getCurrentTeamRunId,
  getTeamTask,
  listTeamTasks,
} from "../session/index.js";
import { currentDispatchScope } from "../subagent/dispatchScope.js";

import {
  TASK_CREATE_TOOL_META,
  TASK_GET_TOOL_META,
  TASK_LIST_TOOL_META,
  TASK_UPDATE_TOOL_META,
} from "./teamTaskMeta.js";
import type { Tool } from "./types.js";

function activeTeam(): string | undefined {
  return getCurrentTeamRunId();
}

function noTeam(): string {
  return "No active team run. Summon a team before using the task tools.";
}

export const taskCreateTool: Tool = {
  ...TASK_CREATE_TOOL_META,
  run: async (args: {
    subject: string;
    description?: string;
    depends_on?: string[];
  }) => {
    const runId = activeTeam();
    if (!runId) return noTeam();
    const subject = String(args.subject ?? "").trim();
    const description =
      typeof args.description === "string"
        ? args.description.trim()
        : undefined;
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const hook = await fireTaskCreated(
      taskId,
      subject,
      description,
      undefined,
    ).catch(() => undefined);
    if (hook?.blocked) {
      return `Task creation blocked: ${hook.blockReason ?? "A task hook refused it."}`;
    }
    const task = createTeamTask(runId, {
      taskId,
      subject,
      description,
      dependsOn: Array.isArray(args.depends_on) ? args.depends_on : [],
    });
    if (task) {
      return JSON.stringify(task);
    }
    return "Task was not created. Check the subject, dependencies and team status.";
  },
};

export const taskListTool: Tool = {
  ...TASK_LIST_TOOL_META,
  run: async () => {
    const runId = activeTeam();
    if (!runId) return noTeam();
    return JSON.stringify(listTeamTasks(runId));
  },
};

export const taskGetTool: Tool = {
  ...TASK_GET_TOOL_META,
  run: async ({ task_id }: { task_id: string }) => {
    const runId = activeTeam();
    if (!runId) return noTeam();
    const task = getTeamTask(runId, task_id);
    return task ? JSON.stringify(task) : `Task not found: ${task_id}`;
  },
};

export const taskUpdateTool: Tool = {
  ...TASK_UPDATE_TOOL_META,
  run: async (args: { task_id: string; status: string; owner?: string }) => {
    const runId = activeTeam();
    if (!runId) return noTeam();
    const runtime = currentDispatchScope()?.runtime;
    const existing = getTeamTask(runId, args.task_id);
    if (!existing) return `Task not found: ${args.task_id}`;
    if (args.status === "in_progress") {
      const owner = runtime?.agentType ?? args.owner?.trim();
      if (!owner) return "A task claim needs an owner.";
      if (existing.owner && existing.owner !== owner) {
        return `Task is already owned by ${existing.owner}.`;
      }
      if (existing.blocked)
        return "Task is blocked by incomplete dependencies.";
      const task = claimTeamTask(runId, args.task_id, owner);
      return task
        ? JSON.stringify(task)
        : "Task cannot be claimed. It may be blocked, completed or already owned.";
    }
    if (args.status === "completed") {
      const member = runtime?.agentType;
      if (member && existing.owner && existing.owner !== member) {
        return `Task is owned by ${existing.owner}, not ${member}.`;
      }
      if (existing.blocked)
        return "Task is blocked by incomplete dependencies.";
      const owner =
        member ?? (runtime ? undefined : args.owner?.trim() || undefined);
      const hook = await fireTaskCompleted(
        existing.taskId,
        existing.subject,
        existing.description,
        owner,
      ).catch(() => undefined);
      if (hook?.blocked) {
        return `Task completion blocked: ${hook.blockReason ?? "A task hook refused it."}`;
      }
      const task = completeTeamTask(runId, args.task_id, owner);
      if (task) {
        return JSON.stringify(task);
      }
      return "Task cannot be completed.";
    }
    return "TaskUpdate status must be in_progress or completed.";
  },
};
