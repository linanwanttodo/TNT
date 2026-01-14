import { describe, expect, it, vi } from "vitest";

import {
  BackgroundJobService,
  type PolledJobResult,
} from "./BackgroundJobService.js";

function poller(results: PolledJobResult[], cancel = vi.fn(async () => {})) {
  return {
    poll: vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error("polled too many times");
      return next;
    }),
    cancel,
  };
}

describe("polled background jobs", () => {
  it("replaces output on each poll and completes when the process exits", async () => {
    const service = new BackgroundJobService();
    const job = service.registerPolledJob(
      "sleep 1",
      poller([
        { done: false, output: "line 1\n" },
        { done: true, output: "line 1\nline 2\n", exitCode: 0 },
      ]),
      "session-1",
    );
    expect(job).not.toBeNull();
    expect(job?.status).toBe("running");

    expect(await service.refreshJob(job!.id)).toMatchObject({
      status: "running",
      output: "line 1\n",
      exitCode: null,
    });
    expect(await service.refreshJob(job!.id)).toMatchObject({
      status: "completed",
      output: "line 1\nline 2\n",
      exitCode: 0,
    });
  });

  it("fails a job when polling throws", async () => {
    const service = new BackgroundJobService();
    const poll = vi.fn(async () => {
      throw new Error("terminal is gone");
    });
    const job = service.registerPolledJob("sleep 1", { poll }, "session-1");

    expect(await service.refreshJob(job!.id)).toMatchObject({
      status: "failed",
      error: "terminal is gone",
    });
  });

  it("cancels only the named session's terminals", async () => {
    const service = new BackgroundJobService();
    const cancelA = vi.fn(async () => {});
    const cancelB = vi.fn(async () => {});
    const pollA = poller([{ done: false, output: "" }], cancelA);
    const a = service.registerPolledJob("a", pollA, "session-a");
    const b = service.registerPolledJob(
      "b",
      poller([{ done: false, output: "" }], cancelB),
      "session-b",
    );

    await service.cancelPolledJobs("session-a");

    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();
    expect(service.getJob(a!.id)?.status).toBe("cancelled");
    expect(service.getJob(b!.id)?.status).toBe("running");
    // A cancelled job must not be polled again; the terminal is already gone.
    expect(await service.refreshJob(a!.id)).toMatchObject({
      status: "cancelled",
    });
    expect(pollA.poll).not.toHaveBeenCalled();

    await service.cancelPolledJobs();
    expect(cancelB).toHaveBeenCalledOnce();
    expect(service.getJob(b!.id)?.status).toBe("cancelled");
  });
});
