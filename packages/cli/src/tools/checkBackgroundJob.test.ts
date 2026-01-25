import { afterEach, describe, expect, it, vi } from "vitest";

import { textRun } from "../../test-utils/toolText.js";
import { backgroundJobService } from "../services/BackgroundJobService.js";

import { checkBackgroundJobTool } from "./checkBackgroundJob.js";

const runText = textRun(checkBackgroundJobTool);

afterEach(async () => {
  await backgroundJobService.cancelPolledJobs();
  vi.unstubAllEnvs();
});

describe("CheckBackgroundJob", () => {
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
