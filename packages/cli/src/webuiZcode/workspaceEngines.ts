/* eslint-disable max-classes-per-file */
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { parseConversationTopic } from "@zcode/shared/zcode-protocol-v4";

import {
  AppServerProtocol,
  type AppServerProtocolOptions,
  type ProtocolSender,
} from "../appServer/protocol.js";
import { SessionRegistry } from "../appServer/sessionRegistry.js";
import { sessionStore } from "../session/store.js";
import { logger } from "../utils/logger.js";

import {
  EngineClient,
  EngineRequestError,
  type EngineClientOptions,
  type EngineCommand,
  type EngineNotification,
  type EngineNotificationListener,
  type EngineRequestHandler,
} from "./engineClient.js";
import { canonicalWorkspacePath } from "./services/workspaceScope.js";

export {
  DEFAULT_ENGINE_IDLE_TIMEOUT_MS,
  DEFAULT_ENGINE_REQUEST_TIMEOUT_MS,
  EngineClient,
  EngineClientError,
  EngineRequestError,
  resolveEngineCommand,
  type EngineCommand,
  type EngineClientOptions,
  type EngineNotification,
  type EngineNotificationListener,
  type EngineRequestHandler,
} from "./engineClient.js";

export interface WorkspaceEngine {
  readonly workspacePath: string;
  readonly kind: "host" | "child";
  readonly pid: number | null;
  readonly isRunning: boolean;
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  subscribe(listener: EngineNotificationListener): () => void;
  setRequestHandler(handler: EngineRequestHandler | null): void;
  dispose(): Promise<void>;
}

export interface WorkspaceSessionMeta {
  workspaceDirectory?: string;
  workspacePath?: string;
  cwd?: string;
}

export interface WorkspaceEnginesOptions {
  hostWorkspacePath: string;
  hostProtocolOptions?: AppServerProtocolOptions;
  createHostProtocol?: (
    sender: ProtocolSender,
    workspacePath: string,
  ) => AppServerProtocol;
  command?: EngineCommand;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface RecordValue {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSync(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

interface LoopbackCallbacks {
  onNotification(notification: EngineNotification): void;
  onServerRequest(id: string, method: string, params: unknown): void;
  onResponse(message: RecordValue): void;
}

/**
 * The in-process half of the app-server wire. The host protocol writes its
 * responses, notifications and server-initiated requests here instead of to a
 * pipe, so the registry speaks exactly the protocol a child engine speaks.
 */
class LoopbackTransport implements ProtocolSender {
  private callbacks: LoopbackCallbacks | null = null;

  attach(callbacks: LoopbackCallbacks): void {
    this.callbacks = callbacks;
  }

  async send(message: unknown): Promise<void> {
    if (!isRecord(message)) {
      return;
    }
    const hasId = Object.hasOwn(message, "id") && message.id !== undefined;
    if (typeof message.method === "string") {
      if (hasId) {
        this.callbacks?.onServerRequest(
          String(message.id),
          message.method,
          message.params,
        );
        return;
      }
      this.callbacks?.onNotification({
        method: message.method,
        params: message.params,
      });
      return;
    }
    if (hasId) {
      this.callbacks?.onResponse(message);
    }
  }
}

class HostWorkspaceEngine implements WorkspaceEngine {
  readonly kind = "host" as const;
  private readonly protocol: AppServerProtocol;
  private readonly transport = new LoopbackTransport();
  private readonly listeners = new Set<EngineNotificationListener>();
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private requestHandler: EngineRequestHandler | null = null;
  private nextRequestId = 0;
  private disposed = false;

  constructor(
    readonly workspacePath: string,
    createProtocol: (
      sender: ProtocolSender,
      workspacePath: string,
    ) => AppServerProtocol,
  ) {
    this.protocol = createProtocol(this.transport, workspacePath);
    this.transport.attach({
      onNotification: (notification) => {
        for (const listener of this.listeners) {
          listener(notification);
        }
      },
      onServerRequest: (id, method, params) => {
        void this.answerServerRequest(id, method, params);
      },
      onResponse: (message) => {
        const id = String(message.id);
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        if (message.error !== undefined) {
          const error = isRecord(message.error) ? message.error : {};
          pending.reject(
            new EngineRequestError(
              typeof error.code === "number" ? error.code : -32603,
              typeof error.message === "string"
                ? error.message
                : `Host engine request ${id} failed`,
            ),
          );
          return;
        }
        pending.resolve(message.result);
      },
    });
  }

  get pid(): number | null {
    return null;
  }

  get isRunning(): boolean {
    return !this.disposed;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) {
      throw new Error("Host workspace engine is disposed");
    }
    const requested = explicitWorkspacePath(isRecord(params) ? params : {});
    if (requested && resolveSync(requested) !== this.workspacePath) {
      throw new Error(
        `Host engine for ${this.workspacePath} cannot serve ${requested}; use WorkspaceEngines.dispatch()`,
      );
    }
    this.nextRequestId += 1;
    const id = `host-${this.nextRequestId}`;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      await this.protocol.handle({ id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    return result;
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

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.protocol.dispose();
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new Error("Host workspace engine is disposed"));
    }
    this.listeners.clear();
    this.requestHandler = null;
  }

  private async answerServerRequest(
    id: string,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      if (!this.requestHandler) {
        throw new Error(`No handler for engine request ${method}`);
      }
      const result = await this.requestHandler(method, params);
      await this.protocol.handle({ id, result: result ?? null });
    } catch (error) {
      await this.protocol.handle({
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

/**
 * The process-wide workspace engine registry.
 *
 * The host workspace is served by an in-process app-server protocol; every
 * other registered workspace is served by one `app-server --stdio` child whose
 * cwd is that workspace. Calls are routed by the workspace path in the params,
 * or by the persisted workspace of the session named in the params.
 */
export class WorkspaceEngines {
  private readonly hostPath: string;
  private readonly hostProtocolOptions: AppServerProtocolOptions;
  private readonly createHostProtocol: (
    sender: ProtocolSender,
    workspacePath: string,
  ) => AppServerProtocol;
  private readonly command: EngineCommand | undefined;
  private readonly requestTimeoutMs: number | undefined;
  private readonly idleTimeoutMs: number | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;

  private readonly rootOrder: string[] = [];
  private readonly rootLookup = new Map<string, string>();
  private readonly engines = new Map<string, WorkspaceEngine>();
  private disposed = false;

  constructor(options: WorkspaceEnginesOptions) {
    this.hostPath = resolveSync(options.hostWorkspacePath);
    this.hostProtocolOptions = options.hostProtocolOptions ?? {};
    this.createHostProtocol =
      options.createHostProtocol ??
      ((sender, workspacePath) =>
        new AppServerProtocol(sender, new SessionRegistry(workspacePath), {
          ...this.hostProtocolOptions,
          workspaces: this.hostProtocolOptions.workspaces ?? {
            add: async (candidate: string) => {
              await this.add(candidate);
            },
          },
        }));
    this.command = options.command;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.env = options.env;
    this.registerRoot(path.resolve(options.hostWorkspacePath), this.hostPath);
  }

  /** Canonical workspace roots, host first. */
  roots(): string[] {
    return [...this.rootOrder];
  }

  isRegistered(candidate: string): boolean {
    return this.rootLookup.has(path.resolve(candidate));
  }

  /**
   * Registers a workspace as an allowed root. The root is added before the
   * workspace is used, so file, git and terminal calls against it pass the
   * boundary check. Returns the canonical path.
   */
  async add(candidate: string): Promise<string> {
    if (this.disposed) {
      throw new Error("Workspace engines are disposed");
    }
    const resolved = path.resolve(candidate);
    const existing = this.rootLookup.get(resolved);
    if (existing) {
      return existing;
    }
    let info;
    try {
      info = await stat(resolved);
    } catch (error) {
      throw new Error(
        `Workspace does not exist: ${candidate} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (!info.isDirectory()) {
      throw new Error(`Workspace is not a directory: ${candidate}`);
    }
    const canonical = await canonicalWorkspacePath(resolved);
    this.registerRoot(resolved, canonical);
    return canonical;
  }

  /** The engine for a registered workspace; throws when the root is unknown. */
  getForPath(candidate: string): WorkspaceEngine {
    const resolved = path.resolve(candidate);
    const canonical = this.rootLookup.get(resolved);
    if (!canonical) {
      throw new Error(
        `Workspace is not registered: ${candidate}. Call add() before using it.`,
      );
    }
    return this.engineFor(canonical);
  }

  /** The engine for the session's persisted workspace, registering it. */
  async getForSession(
    meta: WorkspaceSessionMeta | string,
  ): Promise<WorkspaceEngine> {
    const workspace =
      typeof meta === "string"
        ? meta
        : meta.workspaceDirectory || meta.workspacePath || meta.cwd;
    if (!workspace) {
      throw new Error("Session has no persisted workspace");
    }
    const canonical = await this.add(workspace);
    return this.getForPath(canonical);
  }

  /**
   * Routes a protocol call by its workspace: an explicit workspace path wins,
   * then the persisted workspace of the session it names, then the host.
   */
  async dispatch(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    const workspace = await this.workspaceFor(params);
    return this.getForPath(workspace).request(method, params, options);
  }

  /** Subscribes to one workspace's notifications (session events, frames). */
  async subscribe(
    candidate: string,
    listener: EngineNotificationListener,
  ): Promise<() => void> {
    const canonical = await this.add(candidate);
    return this.getForPath(canonical).subscribe(listener);
  }

  /** Installs the handler for one workspace's server-initiated requests. */
  async setRequestHandler(
    candidate: string,
    handler: EngineRequestHandler | null,
  ): Promise<void> {
    const canonical = await this.add(candidate);
    this.getForPath(canonical).setRequestHandler(handler);
  }

  /** Disposes the engine behind a workspace and removes it from the roots. */
  async closeWorkspace(candidate: string): Promise<void> {
    const resolved = path.resolve(candidate);
    const canonical =
      this.rootLookup.get(resolved) ??
      (await canonicalWorkspacePath(resolved).catch(() => resolved));
    // The host engine is the process's own workspace; removing it would drop
    // the root every relative path and default cwd resolves against.
    if (canonical === this.hostPath || resolved === this.hostPath) {
      throw new Error(`The host workspace cannot be removed: ${candidate}`);
    }
    const engine = this.engines.get(canonical);
    this.engines.delete(canonical);
    this.rootLookup.delete(resolved);
    this.rootLookup.delete(canonical);
    const index = this.rootOrder.indexOf(canonical);
    if (index >= 0 && canonical !== this.hostPath) {
      this.rootOrder.splice(index, 1);
    }
    await engine?.dispose();
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const engines = [...this.engines.values()];
    this.engines.clear();
    this.rootLookup.clear();
    this.rootOrder.length = 0;
    await Promise.all(engines.map((engine) => engine.dispose()));
  }

  private registerRoot(resolved: string, canonical: string): void {
    this.rootLookup.set(resolved, canonical);
    this.rootLookup.set(canonical, canonical);
    if (!this.rootOrder.includes(canonical)) {
      this.rootOrder.push(canonical);
    }
  }

  private engineFor(canonical: string): WorkspaceEngine {
    const existing = this.engines.get(canonical);
    if (existing) {
      return existing;
    }
    let engine: WorkspaceEngine;
    if (canonical === this.hostPath) {
      engine = new HostWorkspaceEngine(canonical, (sender, workspacePath) =>
        this.createHostProtocol(sender, workspacePath),
      );
    } else {
      const childOptions = { workspacePath: canonical } as EngineClientOptions;
      if (this.command) {
        childOptions.command = this.command;
      }
      if (this.requestTimeoutMs !== undefined) {
        childOptions.requestTimeoutMs = this.requestTimeoutMs;
      }
      if (this.idleTimeoutMs !== undefined) {
        childOptions.idleTimeoutMs = this.idleTimeoutMs;
      }
      if (this.env) {
        childOptions.env = this.env;
      }
      engine = new EngineClient(childOptions);
    }
    this.engines.set(canonical, engine);
    return engine;
  }

  private async workspaceFor(params: unknown): Promise<string> {
    const record = isRecord(params) ? params : {};
    const explicit = explicitWorkspacePath(record);
    if (explicit) {
      return this.add(explicit);
    }

    // A v4 createSession names its workspace in the command payload, before
    // any session id exists.
    const payload = isRecord(record.payload) ? record.payload : {};
    if (typeof payload.workspaceId === "string" && payload.workspaceId) {
      return this.add(payload.workspaceId);
    }

    const sessionId = sessionIdFrom(record);
    if (sessionId) {
      const meta = this.metaFor(sessionId);
      if (meta?.workspaceDirectory) {
        return this.add(meta.workspaceDirectory);
      }
      if (meta?.workspacePath) {
        return this.add(meta.workspacePath);
      }
    }
    return this.hostPath;
  }

  private metaFor(
    sessionId: string,
  ): { workspaceDirectory?: string; workspacePath?: string } | null {
    try {
      const meta = sessionStore.getMeta(sessionId);
      if (!meta) {
        return null;
      }
      return {
        workspaceDirectory: meta.workspaceDirectory || undefined,
      };
    } catch (error) {
      logger.debug("Workspace engines: session meta lookup failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function explicitWorkspacePath(record: RecordValue): string | null {
  const workspace = record.workspace;
  if (isRecord(workspace)) {
    if (typeof workspace.workspacePath === "string") {
      return workspace.workspacePath;
    }
  }
  if (typeof record.workspacePath === "string") {
    return record.workspacePath;
  }
  return null;
}

function sessionIdFrom(record: RecordValue): string | null {
  if (typeof record.sessionId === "string" && record.sessionId.length > 0) {
    return record.sessionId;
  }
  if (typeof record.topic === "string") {
    return parseConversationTopic(record.topic);
  }
  return null;
}
