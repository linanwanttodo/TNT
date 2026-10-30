import { ChildProcess, spawn } from "child_process";

import { logger } from "../utils/logger.js";

export type BackgroundJobStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * What launched the job. The footer collapses counts per kind (`1 shell`,
 * `1 shell · 1 monitor`), so a new producer declares itself here instead of
 * every label site learning it.
 */
export type BackgroundJobKind = "shell" | "monitor" | "polled";

export interface BackgroundJob {
  id: string;
  status: BackgroundJobStatus;
  kind: BackgroundJobKind;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date | null;
  error?: string;
}

const MAX_CONCURRENT_JOBS = 5;
const MAX_OUTPUT_LINES = 1000;

export interface PolledJobResult {
  done: boolean;
  output: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
}

/**
 * A job whose process belongs to someone else, such as the editor's terminal.
 * Polling replaces the captured output, because the owner already returns the
 * whole buffer rather than an increment.
 */
export interface PolledJob {
  poll(): Promise<PolledJobResult>;
  cancel?(): Promise<void>;
}

/**
 * Service for managing background job execution and lifecycle
 * Handles spawning, tracking, and cleanup of background processes
 */
let exitHookRegistered = false;

export class BackgroundJobService {
  private jobs: Map<string, BackgroundJob> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private polled: Map<string, { sessionId: string; job: PolledJob }> =
    new Map();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    // A background job cannot be checked once the process that tracked it is
    // gone, and several exits bypass the graceful path, so sweep on the way out.
    // Registered once for the process, not once per instance.
    if (!exitHookRegistered) {
      exitHookRegistered = true;
      process.once("exit", () => this.killAllJobs());
    }
  }

  /**
   * The composer's task indicator reads the job list through this store: the
   * lifecycle methods bump the version and the hook re-renders on it.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private jobCounter = 0;

  createJob(
    command: string,
    kind: BackgroundJobKind = "shell",
  ): BackgroundJob | null {
    const runningCount = this.getRunningJobCount();
    if (runningCount >= MAX_CONCURRENT_JOBS) {
      logger.warn(
        `Cannot create background job: limit of ${MAX_CONCURRENT_JOBS} reached`,
      );
      return null;
    }

    const id = `bg-${++this.jobCounter}-${Date.now()}`;
    const job: BackgroundJob = {
      id,
      status: "pending",
      kind,
      command,
      output: "",
      exitCode: null,
      startTime: new Date(),
      endTime: null,
    };

    this.jobs.set(id, job);
    this.notify();
    return job;
  }

  startJob(jobId: string, shell: string, args: string[]): ChildProcess | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error(`Cannot start job ${jobId}: job not found`);
      return null;
    }

    job.status = "running";

    const child = spawn(shell, args, { stdio: "pipe" });
    this.processes.set(jobId, child);
    this.notify();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (data: string) => {
      this.appendOutput(jobId, data);
    });

    child.stderr?.on("data", (data: string) => {
      this.appendOutput(jobId, data);
    });

    child.on("close", (code: number | null) => {
      this.completeJob(jobId, code ?? 0);
    });

    child.on("error", (error: Error) => {
      this.failJob(jobId, error.message);
    });

    return child;
  }

  createJobWithProcess(
    command: string,
    child: ChildProcess,
    existingOutput: string = "",
    kind: BackgroundJobKind = "shell",
  ): BackgroundJob | null {
    const runningCount = this.getRunningJobCount();
    if (runningCount >= MAX_CONCURRENT_JOBS) {
      logger.warn(
        `Cannot create background job: limit of ${MAX_CONCURRENT_JOBS} reached`,
      );
      return null;
    }

    const id = `bg-${++this.jobCounter}-${Date.now()}`;
    const job: BackgroundJob = {
      id,
      status: "running",
      kind,
      command,
      output: existingOutput,
      exitCode: null,
      startTime: new Date(),
      endTime: null,
    };

    this.jobs.set(id, job);
    this.processes.set(id, child);
    this.notify();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (data: string) => {
      this.appendOutput(id, data);
    });

    child.stderr?.on("data", (data: string) => {
      this.appendOutput(id, data);
    });

    child.on("close", (code: number | null) => {
      this.completeJob(id, code ?? 0);
    });

    child.on("error", (error: Error) => {
      this.failJob(id, error.message);
    });

    return job;
  }

  registerPolledJob(
    command: string,
    job: PolledJob,
    sessionId: string,
    existingOutput: string = "",
    kind: BackgroundJobKind = "shell",
  ): BackgroundJob | null {
    const runningCount = this.getRunningJobCount();
    if (runningCount >= MAX_CONCURRENT_JOBS) {
      logger.warn(
        `Cannot create background job: limit of ${MAX_CONCURRENT_JOBS} reached`,
      );
      return null;
    }

    const id = `bg-${++this.jobCounter}-${Date.now()}`;
    const created: BackgroundJob = {
      id,
      status: "running",
      kind,
      command,
      output: existingOutput,
      exitCode: null,
      startTime: new Date(),
      endTime: null,
    };

    this.jobs.set(id, created);
    this.polled.set(id, { sessionId, job });
    this.notify();
    return created;
  }

  /** Refresh one polled job before a caller reads its output and status. */
  async refreshJob(jobId: string): Promise<BackgroundJob | undefined> {
    const job = this.jobs.get(jobId);
    const entry = this.polled.get(jobId);
    if (!job || !entry) return job;
    if (job.status !== "running" && job.status !== "pending") return job;

    try {
      const result = await entry.job.poll();
      this.setOutput(jobId, result.output);
      if (result.error) {
        this.failJob(jobId, result.error);
      } else if (result.done) {
        this.completeJob(jobId, result.exitCode ?? (result.signal ? 1 : 0));
      }
    } catch (error) {
      this.failJob(
        jobId,
        error instanceof Error ? error.message : String(error),
      );
    }

    return this.jobs.get(jobId);
  }

  /** Stop polled terminals, optionally only those of one session. */
  async cancelPolledJobs(sessionId?: string): Promise<void> {
    const entries = [...this.polled.entries()].filter(
      ([, entry]) => sessionId === undefined || entry.sessionId === sessionId,
    );
    await Promise.all(
      entries.map(async ([id, entry]) => {
        try {
          await entry.job.cancel?.();
        } catch {
          // The client may already have closed the terminal.
        }
        this.cancelJob(id);
      }),
    );
  }

  private setOutput(jobId: string, output: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const lines = output.split("\n");
    job.output =
      lines.length > MAX_OUTPUT_LINES
        ? lines.slice(-MAX_OUTPUT_LINES).join("\n")
        : output;
  }

  // todo: improve write efficiency with ring buffer or similar
  appendOutput(jobId: string, data: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.output += data;
      const lines = job.output.split("\n");
      if (lines.length > MAX_OUTPUT_LINES) {
        job.output = lines.slice(-MAX_OUTPUT_LINES).join("\n");
      }
    }
  }

  completeJob(jobId: string, exitCode: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      if (job.status === "cancelled") {
        return;
      }
      job.status = exitCode === 0 ? "completed" : "failed";
      job.exitCode = exitCode;
      job.endTime = new Date();
      this.processes.delete(jobId);
      this.polled.delete(jobId);
      this.notify();
    }
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = error;
      job.endTime = new Date();
      this.processes.delete(jobId);
      this.polled.delete(jobId);
      this.notify();
    }
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    const process = this.processes.get(jobId);

    if (!job) return false;

    if (process) {
      process.kill();
      this.processes.delete(jobId);
    }

    this.polled.delete(jobId);
    job.status = "cancelled";
    job.endTime = new Date();
    this.notify();
    return true;
  }

  getJob(jobId: string): BackgroundJob | undefined {
    return this.jobs.get(jobId);
  }

  getRunningJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === "running" || job.status === "pending",
    );
  }

  getAllJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values());
  }

  getRunningJobCount(): number {
    return this.getRunningJobs().length;
  }

  killAllJobs(): void {
    for (const [jobId, process] of this.processes) {
      process.kill();
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "cancelled";
        job.endTime = new Date();
      }
    }
    this.processes.clear();

    for (const [jobId, entry] of this.polled) {
      const cancelled = entry.job.cancel?.();
      if (cancelled) void cancelled.catch(() => {});
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "cancelled";
        job.endTime = new Date();
      }
    }
    this.polled.clear();
    this.notify();
  }
}

export const backgroundJobService = new BackgroundJobService();
