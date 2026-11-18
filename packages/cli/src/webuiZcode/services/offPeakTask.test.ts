import type { ZCodeAutomation } from "@zcode/shared";
import { describe, expect, it } from "vitest";

import type { AutomationBackend } from "./automations.js";
import { createTntOffPeakTaskService } from "./offPeakTask.js";

/**
 * The adapter maps the automation repo onto the off-peak task channel with
 * only the fields TNT actually has. These cases pin the mapping (no ticket
 * fields fabricated), the id-keyed actions (they resolve the task's own
 * workspace scope first), and the honest grey-out of the ticket form.
 */

const automation = (overrides: Partial<ZCodeAutomation>): ZCodeAutomation => ({
  automationId: "auto-1",
  title: "nightly sweep",
  cronExpr: "0 2 * * *",
  prompt: "sweep the cache",
  workspaceKey: "/ws",
  workspacePath: "/ws",
  locationKind: "local",
  recurring: true,
  runCount: 3,
  enabled: true,
  lifecycleStatus: "active",
  dispatchStatus: "idle",
  dispatchAttempts: 0,
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

const backendWith = (
  automations: ZCodeAutomation[],
  calls: { setEnabled: Array<{ automationId: string; enabled: boolean }> },
): AutomationBackend => {
  const methods = {
    listAllAutomations: async () => automations,
    setAutomationEnabled: async (params: {
      automationId: string;
      enabled: boolean;
    }) => {
      calls.setEnabled.push(params);
      const target = automations.find(
        (a) => a.automationId === params.automationId,
      );
      if (target) target.enabled = params.enabled;
      return target ?? null;
    },
    deleteAutomation: async (params: { automationId: string }) => {
      const index = automations.findIndex(
        (a) => a.automationId === params.automationId,
      );
      if (index >= 0) automations.splice(index, 1);
    },
    updateAutomation: async (
      params: { automationId: string } & Partial<ZCodeAutomation>,
    ) => {
      const target = automations.find(
        (a) => a.automationId === params.automationId,
      );
      if (target) Object.assign(target, params);
      return target ?? null;
    },
  };
  return {
    methods: methods as unknown as AutomationBackend["methods"],
    dispose: () => undefined,
  };
};

describe("the off-peak task adapter over cron automations", () => {
  it("maps the automation fields that exist and fabricates none", async () => {
    const service = createTntOffPeakTaskService({
      backend: backendWith([automation({})], { setEnabled: [] }),
    });

    const tasks = await service.list();
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.offPeakTaskId).toBe("auto-1");
    expect(task.title).toBe("nightly sweep");
    expect(task.prompt).toBe("sweep the cache");
    expect(task.workspacePath).toBe("/ws");
    expect(task.status).toBe("queued");
    expect(task.queuedAt).toBe(1000);
    // Ticket/queue fields stay undefined: TNT has no ticket server.
    expect(task.serverTicketId).toBeUndefined();
    expect(task.queuePosition).toBeUndefined();
    expect(task.schedulable).toBeUndefined();
  });

  it("greys the ticket form out honestly instead of faking a queue", async () => {
    const service = createTntOffPeakTaskService({ backend: null });
    await expect(service.getCodingPlanSupport()).resolves.toEqual({
      supported: false,
      reason: "connection_unavailable",
    });
    await expect(service.getTakeNumberAvailability()).resolves.toEqual({
      canTakeNumber: false,
    });
    await expect(service.list()).rejects.toThrow("ZCODE_UNAVAILABLE");
  });

  it("cancels by disabling the automation, using the task's own scope", async () => {
    const automations = [automation({})];
    const calls = {
      setEnabled: [] as Array<{ automationId: string; enabled: boolean }>,
    };
    const service = createTntOffPeakTaskService({
      backend: backendWith(automations, calls),
    });

    const cancelled = await service.cancelTask("auto-1");

    expect(calls.setEnabled).toEqual([
      { automationId: "auto-1", enabled: false, workspacePath: "/ws" },
    ]);
    expect(cancelled?.status).toBe("paused");
    expect(automations[0]!.enabled).toBe(false);
  });

  it("reports failures and terminal automations with their own status", async () => {
    const service = createTntOffPeakTaskService({
      backend: backendWith(
        [
          automation({
            automationId: "failed",
            lifecycleStatus: "active",
            dispatchStatus: "failed_to_dispatch",
            lastError: "engine gone",
          }),
          automation({
            automationId: "done",
            lifecycleStatus: "completed",
          }),
          automation({
            automationId: "paused",
            lifecycleStatus: "paused",
          }),
        ],
        { setEnabled: [] },
      ),
    });

    const tasks = await service.list();
    expect(tasks.find((t) => t.offPeakTaskId === "failed")?.status).toBe(
      "failed",
    );
    expect(tasks.find((t) => t.offPeakTaskId === "failed")?.failureReason).toBe(
      "engine gone",
    );
    expect(tasks.find((t) => t.offPeakTaskId === "done")?.status).toBe(
      "completed",
    );
    expect(tasks.find((t) => t.offPeakTaskId === "paused")?.status).toBe(
      "paused",
    );
  });
});
