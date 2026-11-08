/* eslint-disable max-classes-per-file, max-lines */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NdjsonTransport } from "../appServer/transport.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_ENGINE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_ENGINE_REQUEST_TIMEOUT_MS = 60 * 1000;

export interface EngineNotification {
  method: string;
  params: unknown;
}

export type EngineNotificationListener = (
  notification: EngineNotification,
) => void;

export type EngineRequestHandler = (
  method: string,
  params: unknown,
) => unknown | Promise<unknown>;

export interface EngineCommand {
  execPath: string;
  args: string[];
}

export interface EngineClientOptions {
  workspacePath: string;
  /** Test seam; defaults to `TNT_APP_SERVER_COMMAND` or the built CLI. */
  command?: EngineCommand;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Extra environment for the child; the host environment is inherited. */
  env?: NodeJS.ProcessEnv;
}

export type EngineErrorCode =
  "ENGINE_TIMEOUT" | "ENGINE_EXITED" | "ENGINE_DISPOSED" | "ENGINE_UNAVAILABLE";

export class EngineClientError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineClientError";
  }
}

/** A JSON-RPC error returned by the engine, preserving its numeric code. */
export class EngineRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "EngineRequestError";
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface RecordValue {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const APP_SERVER_ARGS = ["app-server", "--stdio"];

function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function resolveAppServerEntry(): string {
  const argv1 = process.argv[1];
  if (argv1 && path.basename(argv1) === "tnt.js" && existsSync(argv1)) {
    return path.resolve(argv1);
  }

  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(directory, "dist", "tnt.js");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return path.resolve("dist", "tnt.js");
}

/**
 * The child command for one workspace. `TNT_APP_SERVER_COMMAND` replaces the
 * whole command line (for source runs); it is not appended to, so it must
 * include `app-server --stdio` itself.
 */
export function resolveEngineCommand(command?: EngineCommand): EngineCommand {
  if (command) {
    return command;
  }
  const override = process.env.TNT_APP_SERVER_COMMAND;
  if (override && override.trim().length > 0) {
    const tokens = splitCommand(override);
    if (tokens.length > 0) {
      return { execPath: tokens[0], args: tokens.slice(1) };
    }
  }
  return {
    execPath: process.execPath,
    args: [resolveAppServerEntry(), ...APP_SERVER_ARGS],
  };
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

/**
 * One NDJSON client per child workspace engine.
 *
 * The client owns the process: it spawns it lazily, restarts it on the next
 * request after a crash, and kills it after an idle period. Requests carry ids
 * and time out. Server-initiated requests (the interaction bridge's permission
 * and question prompts) reach the request handler and their answers are written
 * back with the same id.
 */
export class EngineClient {
  readonly kind = "child" as const;
  private child: ChildProcess | null = null;
  private transport: NdjsonTransport | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<EngineNotificationListener>();
  private requestHandler: EngineRequestHandler | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private spawnPromise: Promise<void> | null = null;
  private nextRequestId = 0;
  private disposed = false;
  private stderrTail = "";
  private spawnedProcesses = 0;

  private readonly command: EngineCommand;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: EngineClientOptions) {
    this.command = resolveEngineCommand(options.command);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_ENGINE_REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs =
      options.idleTimeoutMs ?? DEFAULT_ENGINE_IDLE_TIMEOUT_MS;
    this.env = options.env ?? {};
  }

  get workspacePath(): string {
    return this.options.workspacePath;
  }

  get pid(): number | null {
    return this.isRunning ? (this.child?.pid ?? null) : null;
  }

  get isRunning(): boolean {
    return (
      this.child !== null &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }

  get spawnCount(): number {
    return this.spawnedProcesses;
  }

  subscribe(listener: EngineNotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setRequestHandler(handler: EngineRequestHandler | null): void {
    this.requestHandler = handler;
  }

  async request(
    method: string,
    params: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (this.disposed) {
      throw new EngineClientError(
        "ENGINE_DISPOSED",
        "Workspace engine client is disposed",
      );
    }
    await this.ensureStarted();
    this.clearIdleTimer();

    this.nextRequestId += 1;
    const id = `engine-${this.nextRequestId}`;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new EngineClientError(
              "ENGINE_TIMEOUT",
              `Engine request ${method} timed out after ${timeoutMs} ms`,
            ),
          );
          this.scheduleIdle();
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    const transport = this.transport;
    if (!transport) {
      this.settleRequest(
        id,
        new EngineClientError(
          "ENGINE_UNAVAILABLE",
          `Engine process for ${this.workspacePath} is not running`,
        ),
      );
      return result;
    }
    void transport.send({ id, method, params }).catch((error: unknown) => {
      this.settleRequest(
        id,
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    return result;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearIdleTimer();
    this.rejectPending(
      new EngineClientError(
        "ENGINE_DISPOSED",
        "Workspace engine client is disposed",
      ),
    );
    await this.stopChild();
    this.listeners.clear();
    this.requestHandler = null;
  }

  private async ensureStarted(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.spawnPromise ??= this.start();
    try {
      await this.spawnPromise;
    } finally {
      this.spawnPromise = null;
    }
  }

  private async start(): Promise<void> {
    const child = spawn(this.command.execPath, this.command.args, {
      cwd: this.workspacePath,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.spawnedProcesses += 1;
    this.child = child;
    this.stderrTail = "";

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
    });

    const transport = new NdjsonTransport({
      input: child.stdout,
      output: child.stdin,
    });
    this.transport = transport;
    transport.start({
      onMessage: (message) => this.handleMessage(message),
      onLineError: (error) => {
        logger.debug("Workspace engine: unreadable protocol line", {
          workspacePath: this.workspacePath,
          error: error.message,
        });
      },
      onEnd: () => this.handleExit(child),
    });

    child.once("exit", () => this.handleExit(child));
    child.once("error", (error: Error) => this.handleSpawnError(child, error));

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      const onSpawn = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(
          new EngineClientError(
            "ENGINE_UNAVAILABLE",
            `Could not start ${this.command.execPath} for ${this.workspacePath}: ${error.message}`,
          ),
        );
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
    this.scheduleIdle();
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      return;
    }
    const hasId = Object.hasOwn(message, "id") && message.id !== undefined;
    if (typeof message.method === "string") {
      if (hasId) {
        void this.handleServerRequest(
          String(message.id),
          message.method,
          message.params,
        );
        return;
      }
      const notification: EngineNotification = {
        method: message.method,
        params: message.params,
      };
      for (const listener of this.listeners) {
        listener(notification);
      }
      this.scheduleIdle();
      return;
    }
    if (!hasId) {
      return;
    }
    const id = String(message.id);
    if (message.error !== undefined) {
      const error = isRecord(message.error) ? message.error : {};
      this.settleRequest(
        id,
        new EngineRequestError(
          typeof error.code === "number" ? error.code : -32603,
          typeof error.message === "string"
            ? error.message
            : `Engine request ${id} failed`,
        ),
      );
      return;
    }
    this.settleRequest(id, message.result);
  }

  private async handleServerRequest(
    id: string,
    method: string,
    params: unknown,
  ): Promise<void> {
    let response: RecordValue;
    try {
      if (!this.requestHandler) {
        throw new EngineClientError(
          "ENGINE_UNAVAILABLE",
          `No handler for engine request ${method}`,
        );
      }
      const result = await this.requestHandler(method, params);
      response = { id, result: result ?? null };
    } catch (error) {
      response = {
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    try {
      await this.transport?.send(response);
    } catch (error) {
      logger.debug("Workspace engine: server request answer failed", {
        workspacePath: this.workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.scheduleIdle();
  }

  private settleRequest(id: string, outcome: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (outcome instanceof Error) {
      pending.reject(outcome);
    } else {
      pending.resolve(outcome);
    }
    this.scheduleIdle();
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private handleSpawnError(child: ChildProcess, error: Error): void {
    if (this.child !== child) {
      return;
    }
    logger.debug("Workspace engine: spawn failed", {
      workspacePath: this.workspacePath,
      error: error.message,
    });
    this.handleExit(child);
  }

  private handleExit(child: ChildProcess): void {
    if (this.child !== child) {
      return;
    }
    this.child = null;
    this.transport?.stop();
    this.transport = null;
    this.clearIdleTimer();
    if (child.exitCode === null && child.signalCode === null) {
      // stdout ended while the process still lives; never leave it running
      // without a protocol channel to it.
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone; the exit listener below stays authoritative.
      }
    }
    let details = "stream end";
    if (child.exitCode !== null) {
      details = `code ${child.exitCode}`;
    } else if (child.signalCode !== null) {
      details = `signal ${child.signalCode}`;
    }
    const stderr = this.stderrTail.trim();
    this.rejectPending(
      new EngineClientError(
        "ENGINE_EXITED",
        `Engine process for ${this.workspacePath} exited (${details})${stderr.length > 0 ? `: ${stderr}` : ""}`,
      ),
    );
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;
    this.transport?.stop();
    this.transport = null;
    this.clearIdleTimer();
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      child.stdin?.end();
    } catch {
      // The child may already be gone; the exit wait below is authoritative.
    }
    if (await waitForExit(child, 1000)) {
      return;
    }
    child.kill("SIGTERM");
    if (await waitForExit(child, 1000)) {
      return;
    }
    child.kill("SIGKILL");
    await waitForExit(child, 1000);
  }

  private scheduleIdle(): void {
    this.clearIdleTimer();
    if (this.disposed || !this.isRunning || this.pending.size > 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) {
        void this.stopChild();
      }
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
