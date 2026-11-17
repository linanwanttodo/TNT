import {
  IZCodeAgentService,
  type ZCodeAgentRunAutomationNowResult,
} from "@zcode/services";
import {
  AutomationRepo,
  AutomationService,
  computeAutomationNextRunAt,
} from "@zcode/services/node";
import type { ZCodeAutomation, ZCodeAutomationRun } from "@zcode/shared";
import type {
  ZCodeWorkflowRunSummary,
  ZCodeManagedWorktreeEntry,
} from "@zcode/shared";
import {
  commandPayloadSchemas,
  V4_METHODS,
} from "@zcode/shared/zcode-protocol-v4";

import { logger } from "../../utils/logger.js";

import {
  createManagedWorktree,
  listManagedWorktrees,
  managedWorktreeAvailable,
  removeManagedWorktree,
} from "./managedWorktree.js";
import { listWorkspaceWorkflowRuns } from "./workflowRuns.js";

/**
 * The automations backend: every call the automations page makes lands on the
 * vendored `AutomationService` (cron semantics + SQLite repo), and a tick
 * scheduler claims due rows and dispatches them through the v4 command path
 * the WebUI itself uses. Before this existed the page's every call resolved to
 * a `ZCODE_UNAVAILABLE` stub, so the tab painted but could not hold a task.
 */

/** How often the scheduler looks for due work. Cron granularity is a minute. */
const TICK_INTERVAL_MS = 30_000;

export type AutomationServiceMethods = Pick<
  IZCodeAgentService,
  | "listAllAutomations"
  | "createAutomation"
  | "updateAutomation"
  | "deleteAutomation"
  | "setAutomationEnabled"
  | "restartAutomation"
  | "runAutomationNow"
  | "listAutomationRuns"
  | "deleteAutomationRun"
  | "listWorkflowRuns"
  | "createManagedWorktree"
  | "listManagedWorktrees"
  | "removeManagedWorktree"
  | "managedWorktreeAvailable"
>;

type CreateParams = Parameters<IZCodeAgentService["createAutomation"]>[0];
type UpdateParams = Parameters<IZCodeAgentService["updateAutomation"]>[0];
type AutomationIdParams = Parameters<IZCodeAgentService["deleteAutomation"]>[0];
type SetEnabledParams = Parameters<
  IZCodeAgentService["setAutomationEnabled"]
>[0];
type DeleteRunParams = Parameters<IZCodeAgentService["deleteAutomationRun"]>[0];
type WorktreeCreateParams = Parameters<
  IZCodeAgentService["createManagedWorktree"]
>[0];
type WorktreeRemoveParams = Parameters<
  IZCodeAgentService["removeManagedWorktree"]
>[0];

export interface AutomationBackend {
  readonly methods: AutomationServiceMethods;
  dispose(): void;
}

function scopeOf(params: {
  workspacePath: string;
  workspaceIdentity?: string;
}): {
  workspacePath: string;
  workspaceIdentity?: string;
} {
  return {
    workspacePath: params.workspacePath,
    ...whenDefined("workspaceIdentity", params.workspaceIdentity),
  };
}

/**
 * A patch key that is present only when its value is defined. Optional fields
 * must stay absent rather than explicitly undefined: the repo's update path
 * reads "key in object" to tell "leave alone" from "clear".
 */
function whenDefined<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

/**
 * Stable per-dispatch command id. The engine merges retries by
 * (sessionId, commandId), so every attempt of one dispatch must reuse the same
 * value: a fresh random id turns an accepted-but-unacked command into a
 * duplicate session/send once the retry backoff fires. Manual runs carry their
 * runId; scheduled claims keep next_run_at unchanged across the retry window,
 * which is exactly the scheduled runId contract (`automationId:scheduledAt`).
 */
function automationCommandId(
  automation: ZCodeAutomation,
  run?: ZCodeAutomationRun,
): string {
  return (
    run?.runId ??
    `${automation.automationId}:${automation.nextRunAt ?? "scheduled"}`
  );
}

/**
 * Dispatches one automation prompt. A bound session receives the turn; an
 * unbound automation gets a new session in its workspace whose first input is
 * the prompt, exactly what createSession's firstInput already does for a human.
 */
async function dispatchAutomation(
  engines: {
    dispatch: (method: string, params: unknown) => Promise<unknown>;
  },
  automation: ZCodeAutomation,
  commandId: string,
): Promise<string | undefined> {
  if (automation.targetTaskId) {
    const ack = (await engines.dispatch(V4_METHODS.command, {
      commandId,
      clientId: "tnt-automations",
      sessionId: automation.targetTaskId,
      type: "sendText",
      issuedAt: Date.now(),
      payload: commandPayloadSchemas.sendText.parse({
        text: automation.prompt,
        automationId: automation.automationId,
      }),
    })) as { status?: string; result?: { sessionId?: string } };
    // "duplicate" replays the cached result: the retry was already absorbed.
    if (ack?.status !== "accepted" && ack?.status !== "duplicate") {
      throw new Error(ack?.status ?? "sendText rejected");
    }
    return automation.targetTaskId;
  }

  const ack = (await engines.dispatch(V4_METHODS.command, {
    commandId,
    clientId: "tnt-automations",
    sessionId: null,
    type: "createSession",
    issuedAt: Date.now(),
    payload: commandPayloadSchemas.createSession.parse({
      workspaceId: automation.workspacePath,
      firstInput: { text: automation.prompt },
    }),
  })) as { status?: string; result?: { sessionId?: string } };
  if (ack?.status !== "accepted" && ack?.status !== "duplicate") {
    throw new Error(ack?.status ?? "createSession rejected");
  }
  return ack.result?.sessionId;
}

export function createZcodeAutomationBackend(engines: {
  dispatch: (method: string, params: unknown) => Promise<unknown>;
}): AutomationBackend {
  const service = new AutomationService();
  const repo = new AutomationRepo();

  const dispatchClaimed = async (
    automation: ZCodeAutomation,
    run: ZCodeAutomationRun | undefined,
  ): Promise<void> => {
    try {
      const sessionId = await dispatchAutomation(
        engines,
        automation,
        automationCommandId(automation, run),
      );
      await repo.markDispatched(automation.automationId, {
        dispatchedAt: Date.now(),
        nextRunAt: computeAutomationNextRunAt(automation, Date.now()),
      });
      if (run) {
        await repo.markManualRunDispatched({
          runId: run.runId,
          sessionId,
          dispatchedAt: Date.now(),
        });
      }
      logger.info("Automation dispatched", {
        automationId: automation.automationId,
        title: automation.title,
        sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.markDispatchFailed(automation.automationId, {
        failedAt: Date.now(),
        error: message,
        // A failed command dispatch is the engine refusing or being gone; the
        // claim will be retried by the scheduler's own backoff either way.
        kind: "transient",
      });
      logger.error("Automation dispatch failed", {
        automationId: automation.automationId,
        error: message,
      });
    }
  };

  let disposed = false;
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (disposed || ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const claimed = await repo.claimDue(now);
      for (const automation of claimed) {
        await dispatchClaimed(automation, undefined);
      }
      const manualRuns = await repo.claimManualRuns(now);
      for (const claimedManual of manualRuns) {
        await dispatchClaimed(claimedManual.automation, claimedManual.run);
      }
    } catch (error) {
      logger.error("Automation scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  };
  const pollTimer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  // Do not hold the process open for the scheduler alone: the WebUI server
  // owns the process lifetime.
  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }

  const methods: AutomationServiceMethods = {
    listAllAutomations: (): Promise<ZCodeAutomation[]> => service.list(),
    createAutomation: (params: CreateParams): Promise<ZCodeAutomation> =>
      service.create({
        ...whenDefined("projectId", params.projectId),
        title: params.title,
        cronExpr: params.cronExpr,
        ...whenDefined("relativeDelayMinutes", params.relativeDelayMinutes),
        prompt: params.prompt,
        ...(params.modelSelection
          ? { modelSelection: params.modelSelection }
          : {}),
        ...(params.mode
          ? { mode: params.mode as ZCodeAutomation["mode"] }
          : {}),
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        recurring: params.recurring ?? true,
        ...whenDefined("maxRuns", params.maxRuns),
        ...whenDefined("endAt", params.endAt),
        ...(params.scheduleRule ? { scheduleRule: params.scheduleRule } : {}),
      }),
    updateAutomation: (params: UpdateParams): Promise<ZCodeAutomation | null> =>
      service.update(
        params.automationId,
        {
          ...whenDefined("title", params.title),
          ...whenDefined("cronExpr", params.cronExpr),
          ...whenDefined("prompt", params.prompt),
          ...whenDefined("modelSelection", params.modelSelection ?? undefined),
          ...whenDefined(
            "mode",
            (params.mode ?? undefined) as ZCodeAutomation["mode"],
          ),
          ...whenDefined("recurring", params.recurring),
          ...whenDefined("maxRuns", params.maxRuns),
          ...whenDefined("endAt", params.endAt),
          ...whenDefined("scheduleRule", params.scheduleRule ?? undefined),
          ...whenDefined("scheduleEditedByUser", params.scheduleEditedByUser),
        },
        scopeOf(params),
      ),
    deleteAutomation: async (params: AutomationIdParams): Promise<void> => {
      await service.delete(params.automationId, scopeOf(params));
    },
    setAutomationEnabled: async (params: SetEnabledParams): Promise<void> => {
      await service.setEnabled(
        params.automationId,
        params.enabled,
        scopeOf(params),
      );
    },
    restartAutomation: async (params: AutomationIdParams): Promise<void> => {
      await service.restart(params.automationId, scopeOf(params));
    },
    runAutomationNow: async (
      params: AutomationIdParams,
    ): Promise<ZCodeAgentRunAutomationNowResult> => {
      const created = await service.runNow(
        params.automationId,
        scopeOf(params),
      );
      if (created === null) return { status: "duplicate" };
      // runNow only records the claimed manual run; the vendored contract has
      // the current host dispatch it immediately instead of waiting for the
      // scheduler's stale-claim recovery window to pick it up.
      await dispatchClaimed(created.automation, created.run);
      return { status: "queued" };
    },
    listAutomationRuns: (
      params: AutomationIdParams,
    ): Promise<ZCodeAutomationRun[]> =>
      service.listRuns(params.automationId, scopeOf(params)),
    deleteAutomationRun: async (params: DeleteRunParams): Promise<void> => {
      await service.deleteRun(params.runId, scopeOf(params));
    },
    listWorkflowRuns: (params): Promise<ZCodeWorkflowRunSummary[]> =>
      Promise.resolve(
        listWorkspaceWorkflowRuns({
          workspacePath: params.workspacePath,
          ...whenDefined("limit", params.limit),
        }),
      ),
    createManagedWorktree: (params: WorktreeCreateParams) =>
      createManagedWorktree({
        workspacePath: params.workspacePath,
        ...(params.ref ? { ref: params.ref } : {}),
      }),
    listManagedWorktrees: (params: {
      workspacePath: string;
    }): Promise<ZCodeManagedWorktreeEntry[]> =>
      listManagedWorktrees({ workspacePath: params.workspacePath }),
    removeManagedWorktree: async (
      params: WorktreeRemoveParams,
    ): Promise<void> => {
      await removeManagedWorktree({
        workspacePath: params.workspacePath,
        worktreePath: params.worktreePath,
        ...whenDefined("force", params.force),
      });
    },
    managedWorktreeAvailable: (params: {
      workspacePath: string;
    }): Promise<boolean> => managedWorktreeAvailable(params.workspacePath),
  };

  return {
    methods,
    dispose: (): void => {
      disposed = true;
      clearInterval(pollTimer);
    },
  };
}
