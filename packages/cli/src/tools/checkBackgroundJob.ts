import { resolveCachePolicy } from "@tnt/openai-adapters";

import type { BackgroundJob } from "../services/BackgroundJobService.js";
import { services } from "../services/index.js";

import { Tool } from "./types.js";

const POLL_INTERVAL_MS = 250;
const MAX_BLOCK_MS = 120_000;

function blockedFor(raw: unknown): number {
  const value = typeof raw === "number" ? Math.floor(raw) : 0;
  return Math.max(0, Math.min(MAX_BLOCK_MS, value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeTtl(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 120
    ? `${Math.round(minutes / 60)} hours`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export const checkBackgroundJobTool: Tool = {
  name: "CheckBackgroundJob",
  displayName: "Check Background Job",
  description: `Check the status and output of a background job.
Returns the current status, exit code (if finished), and all available output.
If the job is still running, returns partial output with "running" status.
Pass block_until_ms to wait for the job to finish before returning.`,
  parameters: {
    type: "object",
    required: ["job_id"],
    properties: {
      job_id: {
        type: "string",
        description:
          "The ID of the background job to check (e.g., bg-1-1234567890)",
      },
      block_until_ms: {
        type: "number",
        description:
          "Wait up to this many milliseconds for a running job to finish before returning. Capped at 120000.",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({
    job_id,
    block_until_ms,
  }: {
    job_id: string;
    block_until_ms?: number;
  }): Promise<string> => {
    // A job owned by the editor's terminal has no local process, so its output
    // and status only change when this check asks the client.
    let job = await services.backgroundJobs.refreshJob(job_id);

    if (!job) {
      return JSON.stringify({
        error: `Job ${job_id} not found`,
        available_jobs: services.backgroundJobs
          .getAllJobs()
          .map((j: BackgroundJob) => ({
            id: j.id,
            status: j.status,
            command:
              j.command.substring(0, 50) + (j.command.length > 50 ? "..." : ""),
          })),
      });
    }

    const blockMs = blockedFor(block_until_ms);
    const waitStarted = Date.now();
    let waited = 0;
    while (
      blockMs > 0 &&
      (job.status === "running" || job.status === "pending")
    ) {
      const remaining = blockMs - (Date.now() - waitStarted);
      if (remaining <= 0) {
        break;
      }
      await delay(Math.min(POLL_INTERVAL_MS, remaining));
      const refreshed = await services.backgroundJobs.refreshJob(job_id);
      if (!refreshed) {
        break;
      }
      job = refreshed;
      waited = Date.now() - waitStarted;
    }

    const result: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      command: job.command,
      output: job.output,
      started_at: job.startTime.toISOString(),
    };

    if (job.endTime) {
      result.ended_at = job.endTime.toISOString();
      result.duration_seconds = Math.round(
        (job.endTime.getTime() - job.startTime.getTime()) / 1000,
      );
    }

    if (job.exitCode !== null) {
      result.exit_code = job.exitCode;
    }

    if (job.error) {
      result.error = job.error;
    }

    if (waited > 0) {
      result.waited_ms = waited;
    }

    // Only a job that outlasted the wait invites another one, and that is the
    // decision the provider's cache lifetime should inform: past it, the next
    // request re-writes the whole prefix instead of reading it.
    if (waited > 0 && (job.status === "running" || job.status === "pending")) {
      const modelState = services.model.getState();
      const current = modelState.model as {
        provider?: string;
        model?: string;
      } | null;
      const policy = resolveCachePolicy(current?.provider, current?.model);
      if (policy.ttlMs > 0) {
        result.prompt_cache_ttl_seconds = Math.round(policy.ttlMs / 1000);
        result.cache_hint = `This provider's prompt cache lasts about ${describeTtl(
          policy.ttlMs,
        )}; waiting longer than that means the next request re-writes the prefix.`;
      }
    }

    return JSON.stringify(result, null, 2);
  },
};
