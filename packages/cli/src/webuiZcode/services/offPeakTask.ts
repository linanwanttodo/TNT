import type { IOffPeakTaskService } from "@zcode/services";
import type {
  OffPeakCodingPlanSupport,
  OffPeakTaskCreateResult,
  OffPeakTakeNumberAvailability,
  ZCodeAutomation,
  ZCodeOffPeakTask,
  ZCodeOffPeakTaskCreateParams,
  ZCodeOffPeakTaskStatus,
  ZCodeTaskMode,
} from "@zcode/shared";

import type {
  AutomationBackend,
  AutomationServiceMethods,
} from "./automations.js";

/**
 * The off-peak task channel backed by TNT's own cron automations.
 *
 * The vendored shell's scheduled-task tab speaks the off-peak ticket model
 * (a ZCode cloud queue), and its service used to be the unavailable stub, so
 * the task list, the history tab and the card actions all rejected. TNT has no
 * ticket server; its scheduled work is the automation repo this host already
 * drives, so the adapter maps that repo onto the task shape with only the
 * fields that actually exist - ticket/queue fields stay undefined rather than
 * being fabricated.
 */

function scopeOf(params: {
  workspacePath: string;
  workspaceIdentity?: string;
}): { workspacePath: string; workspaceIdentity?: string } {
  return {
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity
      ? { workspaceIdentity: params.workspaceIdentity }
      : {}),
  };
}

/** cron automations map onto the waiting state; terminal/disabled map below. */
function statusOf(automation: ZCodeAutomation): ZCodeOffPeakTaskStatus {
  if (
    automation.lifecycleStatus === "failed" ||
    automation.dispatchStatus === "failed_to_dispatch"
  ) {
    return "failed";
  }
  if (automation.lifecycleStatus === "completed") {
    return "completed";
  }
  if (automation.lifecycleStatus === "paused" || automation.enabled === false) {
    return "paused";
  }
  return "queued";
}

function toOffPeakTask(automation: ZCodeAutomation): ZCodeOffPeakTask {
  const status = statusOf(automation);
  const terminal = status === "completed" || status === "failed";
  return {
    offPeakTaskId: automation.automationId,
    title: automation.title,
    prompt: automation.prompt,
    permissionMode: (automation.mode ?? "default") as ZCodeTaskMode,
    ...(automation.modelSelection
      ? { modelSelection: automation.modelSelection }
      : {}),
    workspaceKey: automation.workspaceKey,
    workspacePath: automation.workspacePath,
    ...(automation.workspaceIdentity
      ? { workspaceIdentity: automation.workspaceIdentity }
      : {}),
    // A session-bound cron delivers into its task; form automations have no
    // session until a run dispatches one, and runs are history rows.
    ...(automation.targetTaskId
      ? {
          conversationId: automation.targetTaskId,
          sessionId: automation.targetTaskId,
        }
      : {}),
    status,
    queuedAt: automation.createdAt,
    ...(automation.lastRunAt ? { startedAt: automation.lastRunAt } : {}),
    ...(terminal ? { endedAt: automation.updatedAt } : {}),
    ...(automation.lastError ? { failureReason: automation.lastError } : {}),
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

export interface TntOffPeakTaskServiceOptions {
  /** Absent on hosts without workspace engines: every task call rejects. */
  backend: AutomationBackend | null;
}

export function createTntOffPeakTaskService(
  options: TntOffPeakTaskServiceOptions,
): IOffPeakTaskService {
  const methods: AutomationServiceMethods | null =
    options.backend?.methods ?? null;

  const requireBackend = (): AutomationServiceMethods => {
    if (!methods) {
      throw new Error("ZCODE_UNAVAILABLE:off-peak backend unavailable");
    }
    return methods;
  };

  const list = async (): Promise<ZCodeOffPeakTask[]> => {
    const automations = await requireBackend().listAllAutomations();
    return automations.map(toOffPeakTask);
  };

  /**
   * Id-keyed operations resolve the task first, then call the backend with the
   * task's own recorded workspace scope - the automation repo keys its rows by
   * the workspace the automation was created in, not by whoever asks.
   */
  const withTask = async <T>(
    offPeakTaskId: string,
    action: (
      task: ZCodeOffPeakTask,
      backend: AutomationServiceMethods,
    ) => Promise<T>,
  ): Promise<T> => {
    const backend = requireBackend();
    const task = (await list()).find(
      (entry) => entry.offPeakTaskId === offPeakTaskId,
    );
    if (!task) return null as T;
    return action(task, backend);
  };

  const getById = async (
    offPeakTaskId: string,
  ): Promise<ZCodeOffPeakTask | null> => {
    const all = await list();
    return all.find((task) => task.offPeakTaskId === offPeakTaskId) ?? null;
  };

  return {
    // TNT has no ZCode coding-plan connection to schedule tickets against;
    // the honest answer greys the ticket form out instead of faking a queue.
    async getCodingPlanSupport(): Promise<OffPeakCodingPlanSupport> {
      return { supported: false, reason: "connection_unavailable" };
    },
    async getTakeNumberAvailability(): Promise<OffPeakTakeNumberAvailability> {
      return { canTakeNumber: false };
    },
    async createTask(
      _params: ZCodeOffPeakTaskCreateParams,
    ): Promise<OffPeakTaskCreateResult> {
      throw new Error(
        "off-peak ticket creation is not supported; use the automation create page",
      );
    },
    async cancelTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
      return withTask(offPeakTaskId, async (task, backend) => {
        await backend.setAutomationEnabled({
          automationId: task.offPeakTaskId,
          enabled: false,
          ...scopeOf(task),
        });
        return getById(task.offPeakTaskId);
      });
    },
    async pauseTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
      return this.cancelTask(offPeakTaskId);
    },
    async continueTask(
      offPeakTaskId: string,
    ): Promise<ZCodeOffPeakTask | null> {
      return withTask(offPeakTaskId, async (task, backend) => {
        await backend.setAutomationEnabled({
          automationId: task.offPeakTaskId,
          enabled: true,
          ...scopeOf(task),
        });
        return getById(task.offPeakTaskId);
      });
    },
    async deleteTask(offPeakTaskId: string): Promise<void> {
      await withTask(offPeakTaskId, async (task, backend) => {
        await backend.deleteAutomation({
          automationId: task.offPeakTaskId,
          ...scopeOf(task),
        });
      });
    },
    async deleteHistory(
      offPeakTaskId: string,
    ): Promise<ZCodeOffPeakTask | null> {
      // TNT keeps automation runs until their retention prunes them; a history
      // row has no local visibility marker to flip, so the call is accepted and
      // nothing is hidden.
      return getById(offPeakTaskId);
    },
    async updateTask(
      offPeakTaskId: string,
      params: { title?: string; prompt?: string },
    ): Promise<ZCodeOffPeakTask | null> {
      return withTask(offPeakTaskId, async (task, backend) => {
        await backend.updateAutomation({
          automationId: task.offPeakTaskId,
          ...scopeOf(task),
          ...(params.title === undefined ? {} : { title: params.title }),
          ...(params.prompt === undefined ? {} : { prompt: params.prompt }),
        });
        return getById(task.offPeakTaskId);
      });
    },
    list,
    async get(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
      return getById(offPeakTaskId);
    },
  };
}
