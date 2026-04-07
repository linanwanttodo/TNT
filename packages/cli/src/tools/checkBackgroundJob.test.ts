import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { textRun } from "../../test-utils/toolText.js";
import { backgroundJobService } from "../services/BackgroundJobService.js";

import { checkBackgroundJobTool } from "./checkBackgroundJob.js";

const runText = textRun(checkBackgroundJobTool);

/**
 * The service is a process-wide singleton and keeps finished jobs so a session
 * can look them up again, so the map outlives the cases that made them. The
 * listing cases are about what the *tool* returns, not about that history.
 */
function emptyJobRegistry(): void {
  (
    backgroundJobService as unknown as { jobs: Map<string, unknown> }
  ).jobs.clear();
}

afterEach(async () => {
  await backgroundJobService.cancelPolledJobs();
  vi.unstubAllEnvs();
});

describe("CheckBackgroundJob", () => {
  beforeEach(() => {
    emptyJobRegistry();
  });

  it("polls a terminal-backed job before reporting it", async () => {
    const job = backgroundJobService.registerPolledJob(
      "sleep 1",
      {
        poll: async () => ({
          done: true,
          output: "finished\n",
          exitCode: 0,
        }),
      },
      "session-1",
    );

    const result = JSON.parse(await runText({ job_id: job!.id }));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("finished\n");
    expect(result.exit_code).toBe(0);
  });

  it("waits for a running job and returns as soon as it finishes", async () => {
    const polls: number[] = [];
    const job = backgroundJobService.registerPolledJob(
      "sleep 1",
      {
        poll: async () => {
          polls.push(Date.now());
          return polls.length >= 2
            ? { done: true, output: "done\n", exitCode: 0 }
            : { done: false, output: "" };
        },
      },
      "session-wait",
    );

    const started = Date.now();
    const result = JSON.parse(
      await runText({
        job_id: job!.id,
        block_until_ms: 3000,
      }),
    );

    expect(result.status).toBe("completed");
    expect(polls.length).toBeGreaterThanOrEqual(2);
    expect(result.waited_ms).toBeGreaterThan(0);
    expect(result.waited_ms).toBeLessThanOrEqual(Date.now() - started);
    expect(result.cache_hint).toBeUndefined();
  });

  it("warns how long the cache survives when a job outlasts the wait", async () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "");
    const job = backgroundJobService.registerPolledJob(
      "sleep 60",
      { poll: async () => ({ done: false, output: "partial\n" }) },
      "session-slow",
    );

    const result = JSON.parse(
      await runText({
        job_id: job!.id,
        block_until_ms: 200,
      }),
    );

    expect(result.status).toBe("running");
    expect(result.output).toBe("partial\n");
    expect(result.waited_ms).toBeGreaterThan(0);
    expect(result.prompt_cache_ttl_seconds).toBe(300);
    expect(result.cache_hint).toContain("5 minutes");
  });

  it("lists the session's jobs when asked without an id", async () => {
    const finished = backgroundJobService.registerPolledJob(
      "ls -la",
      {
        poll: async () => ({ done: true, output: "out\n", exitCode: 0 }),
      },
      "session-1",
    );
    const running = backgroundJobService.registerPolledJob(
      "npm test",
      {
        poll: async () => ({ done: false, output: "still going\n" }),
      },
      "session-1",
    );
    await runText({ job_id: finished!.id });

    const result = JSON.parse(await runText({}));

    expect(result.jobs.map((job: { id: string }) => job.id)).toEqual([
      finished!.id,
      running!.id,
    ]);
    const completed = result.jobs.find(
      (job: { id: string }) => job.id === finished!.id,
    );
    expect(completed.status).toBe("completed");
    expect(completed.exit_code).toBe(0);
    const pending = result.jobs.find(
      (job: { id: string }) => job.id === running!.id,
    );
    expect(pending.status).toBe("running");
  });

  it("says there are none when the session has not started a job", async () => {
    const result = JSON.parse(await runText({}));

    expect(result).toEqual({ jobs: [] });
  });

  it("returns immediately when a finished job is checked", async () => {
    const job = backgroundJobService.registerPolledJob(
      "true",
      {
        poll: async () => ({ done: true, output: "ok\n", exitCode: 0 }),
      },
      "session-done",
    );

    const result = JSON.parse(
      await runText({
        job_id: job!.id,
        block_until_ms: 5000,
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.waited_ms).toBeUndefined();
    expect(result.cache_hint).toBeUndefined();
  });
});
