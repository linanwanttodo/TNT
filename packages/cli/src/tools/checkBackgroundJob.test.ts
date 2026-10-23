import { afterEach, describe, expect, it } from "vitest";

import { backgroundJobService } from "../services/BackgroundJobService.js";

import { checkBackgroundJobTool } from "./checkBackgroundJob.js";

afterEach(async () => {
  await backgroundJobService.cancelPolledJobs();
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

    const result = JSON.parse(
      await checkBackgroundJobTool.run!({ job_id: job!.id }),
    );

    expect(result.status).toBe("completed");
    expect(result.output).toBe("finished\n");
    expect(result.exit_code).toBe(0);
  });
});
