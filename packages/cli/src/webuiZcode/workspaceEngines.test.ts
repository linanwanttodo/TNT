import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFileService } from "@zcode/services/node";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppServerProtocolOptions } from "../appServer/protocol.js";
import type { TurnExecutor, TurnPump } from "../appServer/turns.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import type { RunTurn } from "../services/TurnRunnerService.js";
import { sessionStore } from "../session/store.js";
import { messageQueue } from "../stream/messageQueue.js";

import {
  EngineClient,
  EngineRequestError,
  type EngineNotification,
} from "./engineClient.js";
import {
  createWorkspaceScopedFileService,
  WORKSPACE_BOUNDARY_PREFIX,
} from "./services/workspaceScope.js";
import {
  WorkspaceEngines,
  type WorkspaceEnginesOptions,
} from "./workspaceEngines.js";

const CLI_PATH = fileURLToPath(new URL("../../dist/tnt.js", import.meta.url));
const WAIT_MS = 20_000;

class FakePump implements TurnPump {
  private running = false;
  private controller: AbortController | null = null;
  private active: Promise<void> | null = null;

  startDraining(runTurn?: RunTurn): void {
    if (this.running || !runTurn) {
      return;
    }
    this.running = true;
    this.active = this.drain(runTurn);
  }

  isRunning(): boolean {
    return this.running;
  }

  requestStop(): void {
    this.controller?.abort();
  }

  async whenIdle(): Promise<void> {
    await this.active;
    this.active = null;
  }

  private async drain(runTurn: RunTurn): Promise<void> {
    try {
      let message = messageQueue.getNextMessage();
      while (message) {
        const controller = new AbortController();
        this.controller = controller;
        try {
          await runTurn(message, controller.signal);
        } finally {
          this.controller = null;
        }
        message = messageQueue.getNextMessage();
      }
    } finally {
      this.running = false;
    }
  }
}

interface TurnOptions {
  slow?: boolean;
}

function publishTurn(
  sessionId: string,
  text: string,
  options: TurnOptions = {},
): void {
  const turnId = `${sessionId}:turn-${Date.now()}`;
  let seq = 0;
  const publish = (event: Record<string, unknown>): void => {
    publishAgentEvent({
      sessionId,
      turnId,
      seq: (seq += 1),
      timestamp: Date.now(),
      ...event,
    } as never);
  };
  publish({
    type: "turn.started",
    model: "test-model",
    historyLength: 0,
  });
  publish({ type: "content.delta", delta: text });
  if (!options.slow) {
    publish({ type: "turn.completed", content: text });
  }
}

function slowExecutor(delayMs = 200): TurnExecutor {
  return async (turn, signal) => {
    if (turn.text === "slow") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (signal.aborted) {
        return;
      }
      publishTurn(turn.sessionId, "slow", { slow: false });
      return;
    }
    publishTurn(turn.sessionId, turn.text);
  };
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function notificationType(notification: EngineNotification): string | null {
  const params = notification.params;
  return typeof params === "object" && params !== null
    ? String((params as { type?: unknown }).type ?? "")
    : null;
}

describe("WorkspaceEngines", () => {
  let root: string;
  let workspaceA: string;
  let workspaceB: string;
  let outside: string;
  let previousGlobalDir: string | undefined;
  let engines: WorkspaceEngines | null;

  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `Missing ${CLI_PATH}. Run \`npm run build:bundle\` before this suite.`,
      );
    }
  });

  beforeEach(async () => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    root = mkdtempSync(path.join(tmpdir(), "tnt-workspace-engines-"));
    process.env.TNT_GLOBAL_DIR = root;
    sessionStore.clearAll();
    messageQueue.clearMessages();
    workspaceA = await tempDir("tnt-engine-a-");
    workspaceB = await tempDir("tnt-engine-b-");
    outside = await tempDir("tnt-engine-outside-");
    await writeFile(path.join(workspaceB, "beta.txt"), "beta\n");
    engines = null;
  });

  afterEach(async () => {
    await engines?.dispose();
    engines = null;
    messageQueue.clearMessages();
    sessionStore.releaseAll();
    rmSync(root, { recursive: true, force: true });
    await Promise.all([
      rm(workspaceA, { recursive: true, force: true }),
      rm(workspaceB, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  function createEngines(
    pump: FakePump,
    overrides: Partial<WorkspaceEnginesOptions> = {},
  ): WorkspaceEngines {
    const hostProtocolOptions: AppServerProtocolOptions = {
      modelLookup: {
        getAvailableChatModels: () => [
          { provider: "test", name: "fake", index: 0 },
        ],
      },
      runTurn: slowExecutor(),
      pump,
      ensureServices: async () => undefined,
    };
    engines = new WorkspaceEngines({
      hostWorkspacePath: workspaceA,
      hostProtocolOptions,
      requestTimeoutMs: WAIT_MS,
      idleTimeoutMs: 5 * 60_000,
      ...overrides,
    });
    return engines;
  }

  async function createSession(
    registry: WorkspaceEngines,
    workspacePath: string,
  ): Promise<string> {
    const result = (await registry.dispatch("session/create", {
      workspace: { workspacePath, workspaceKey: workspacePath },
    })) as { session: { sessionId: string } };
    return result.session.sessionId;
  }

  it("isolates sessions, events and stop between two workspaces", async () => {
    const pump = new FakePump();
    const registry = createEngines(pump);

    const sessionA = await createSession(registry, workspaceA);
    const sessionB = await createSession(registry, workspaceB);

    const child = registry.getForPath(workspaceB);
    expect(child.kind).toBe("child");
    expect(child.pid).not.toBeNull();
    const childPid = child.pid as number;
    expect(registry.getForPath(workspaceA).pid).toBeNull();

    await createSession(registry, workspaceB);
    expect(registry.getForPath(workspaceB).pid).toBe(childPid);

    const listA = (await registry.dispatch("session/list", {
      workspace: { workspacePath: workspaceA, workspaceKey: workspaceA },
    })) as { sessions: Array<{ sessionId: string }> };
    const listB = (await registry.dispatch("session/list", {
      workspace: { workspacePath: workspaceB, workspaceKey: workspaceB },
    })) as { sessions: Array<{ sessionId: string }> };

    expect(listA.sessions.map((entry) => entry.sessionId)).toContain(sessionA);
    expect(listA.sessions.map((entry) => entry.sessionId)).not.toContain(
      sessionB,
    );
    expect(listB.sessions.map((entry) => entry.sessionId)).toContain(sessionB);
    expect(listB.sessions.map((entry) => entry.sessionId)).not.toContain(
      sessionA,
    );

    const eventsA: EngineNotification[] = [];
    const eventsB: EngineNotification[] = [];
    const unsubscribeA = registry
      .getForPath(workspaceA)
      .subscribe((notification) => {
        if (notification.method === "session/event") {
          eventsA.push(notification);
        }
      });
    const unsubscribeB = registry
      .getForPath(workspaceB)
      .subscribe((notification) => {
        if (notification.method === "session/event") {
          eventsB.push(notification);
        }
      });

    await registry.dispatch("session/subscribe", {
      sessionId: sessionA,
      deliveryKind: "desktop-continuous",
      includeSnapshot: true,
    });
    await registry.dispatch("session/send", {
      sessionId: sessionA,
      content: "hello from A",
    });
    await pump.whenIdle();
    await waitFor(
      () =>
        eventsA.some(
          (notification) => notificationType(notification) === "turn.completed",
        ),
      "workspace A turn completed",
    );
    expect(eventsB).toHaveLength(0);

    await registry.dispatch("session/send", {
      sessionId: sessionA,
      content: "slow",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(
      registry.dispatch("session/stop", { sessionId: sessionB }),
    ).resolves.toEqual({});
    await pump.whenIdle();
    await waitFor(
      () =>
        eventsA.filter(
          (notification) => notificationType(notification) === "turn.completed",
        ).length === 2,
      "workspace A slow turn survived workspace B's stop",
    );

    unsubscribeA();
    unsubscribeB();

    await registry.closeWorkspace(workspaceB);
    expect(child.isRunning).toBe(false);
    expect(() => registry.getForPath(workspaceB)).toThrow(
      /Workspace is not registered/,
    );
    await waitFor(
      () => !isProcessAlive(childPid),
      "workspace B child process exited",
    );
  });

  it("restarts a crashed child on the next call and keeps one child per workspace", async () => {
    const registry = createEngines(new FakePump());
    await registry.add(workspaceB);

    const engine = registry.getForPath(workspaceB) as unknown as EngineClient;
    await engine.request("runtime/capabilities", {});
    const firstPid = engine.pid as number;
    expect(engine.spawnCount).toBe(1);

    process.kill(firstPid, "SIGKILL");
    await waitFor(() => !engine.isRunning, "crashed child observed as exited");

    const result = (await engine.request("runtime/capabilities", {})) as {
      version?: unknown;
    };
    expect(result.version).toBeDefined();
    expect(engine.spawnCount).toBe(2);
    expect(engine.pid).not.toBe(firstPid);
    expect(engine.pid).not.toBeNull();
  });

  it("refuses a create for a workspace the child does not serve", async () => {
    const registry = createEngines(new FakePump());
    await registry.add(workspaceB);
    const engine = registry.getForPath(workspaceB);

    await expect(
      engine.request("session/create", {
        workspace: { workspacePath: workspaceA, workspaceKey: workspaceA },
      }),
    ).rejects.toThrow(/serves/);
  });

  it("grows the allowed roots when a workspace is added at runtime", async () => {
    const registry = createEngines(new FakePump());
    const fileService = createWorkspaceScopedFileService(
      createFileService(),
      () => registry.roots(),
    );

    await expect(fileService.readdir({ path: workspaceB })).rejects.toThrow(
      WORKSPACE_BOUNDARY_PREFIX,
    );
    await expect(fileService.readdir({ path: outside })).rejects.toThrow(
      WORKSPACE_BOUNDARY_PREFIX,
    );

    await registry.add(workspaceB);

    const entries = await fileService.readdir({ path: workspaceB });
    expect(entries.map((entry) => entry.name)).toContain("beta.txt");
    expect(registry.roots()).toHaveLength(2);
    expect(registry.isRegistered(workspaceA)).toBe(true);
    expect(registry.isRegistered(workspaceB)).toBe(true);
    await expect(fileService.readdir({ path: outside })).rejects.toThrow(
      WORKSPACE_BOUNDARY_PREFIX,
    );
  });

  it("disposes every child when the registry is disposed", async () => {
    const registry = createEngines(new FakePump());
    await createSession(registry, workspaceB);
    const engine = registry.getForPath(workspaceB);
    const pid = engine.pid as number;
    expect(pid).not.toBeNull();

    await registry.dispose();
    engines = null;

    expect(engine.isRunning).toBe(false);
    await waitFor(
      () => !isProcessAlive(pid),
      "child exited on registry dispose",
    );
  });
});

const FIXTURE_SCRIPT = `
const readline = require("node:readline");
const mode = process.env.ENGINE_FIXTURE_MODE || "normal";
const out = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
if (mode === "exit-on-start") {
  setTimeout(() => process.exit(7), 30);
}
let askId = null;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === "test/echo") {
    out({ id: message.id, result: { pid: process.pid } });
    return;
  }
  if (message.method === "test/notify") {
    out({ method: "test/notification", params: { pid: process.pid } });
    out({ id: message.id, result: null });
    return;
  }
  if (message.method === "test/ask") {
    askId = message.id;
    out({ id: "srv-1", method: "interaction/testRequest", params: { pid: process.pid } });
    return;
  }
  if (message.method === "test/slow") {
    return;
  }
  if (message.method === "test/crash") {
    process.exit(9);
  }
  if (message.method === undefined && message.id !== undefined) {
    if (askId !== null) {
      out({ id: askId, result: { answered: message.result } });
      askId = null;
    }
    return;
  }
  out({
    id: message.id,
    error: { code: -32601, message: "Method not found: " + message.method },
  });
});
`;

describe("EngineClient", () => {
  let workspace: string;
  let clientRoot: string;
  let clients: EngineClient[];
  let previousGlobalDir: string | undefined;

  beforeEach(async () => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    clientRoot = await tempDir("tnt-engine-client-");
    process.env.TNT_GLOBAL_DIR = clientRoot;
    workspace = await tempDir("tnt-engine-client-ws-");
    clients = [];
  });

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.dispose()));
    rmSync(clientRoot, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  function createClient(
    options: Partial<ConstructorParameters<typeof EngineClient>[0]> = {},
  ): EngineClient {
    const client = new EngineClient({
      workspacePath: workspace,
      command: {
        execPath: process.execPath,
        args: ["-e", FIXTURE_SCRIPT],
      },
      requestTimeoutMs: 5_000,
      ...options,
    });
    clients.push(client);
    return client;
  }

  it("round-trips requests and delivers notifications", async () => {
    const client = createClient();
    const notifications: EngineNotification[] = [];
    client.subscribe((notification) => notifications.push(notification));

    const result = (await client.request("test/echo", {})) as { pid: number };
    expect(result.pid).toBe(client.pid);

    await client.request("test/notify", {});
    expect(notifications.map((notification) => notification.method)).toEqual([
      "test/notification",
    ]);
  });

  it("answers server-initiated requests through the handler", async () => {
    const client = createClient();
    const seen: string[] = [];
    client.setRequestHandler((method, params) => {
      seen.push(method);
      expect(params).toMatchObject({ pid: client.pid });
      return { decision: "allow" };
    });

    const result = await client.request("test/ask", {});
    expect(seen).toEqual(["interaction/testRequest"]);
    expect(result).toEqual({ answered: { decision: "allow" } });
  });

  it("times out a request that never answers", async () => {
    const client = createClient({ requestTimeoutMs: 100 });
    await expect(client.request("test/slow", {})).rejects.toMatchObject({
      code: "ENGINE_TIMEOUT",
    });
  });

  it("fails in-flight requests on a crash and restarts on the next call", async () => {
    const client = createClient();
    await client.request("test/echo", {});
    const firstPid = client.pid as number;

    const inFlight = client.request("test/slow", {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.kill(firstPid, "SIGKILL");

    await expect(inFlight).rejects.toMatchObject({ code: "ENGINE_EXITED" });
    await waitFor(() => !client.isRunning, "crashed client observed as exited");

    const result = (await client.request("test/echo", {})) as { pid: number };
    expect(result.pid).not.toBe(firstPid);
    expect(client.pid).toBe(result.pid);
    expect(client.spawnCount).toBe(2);
  });

  it("disposes the child after the idle timeout and respawns on use", async () => {
    const client = createClient({ idleTimeoutMs: 60 });
    const firstPid = (
      (await client.request("test/echo", {})) as { pid: number }
    ).pid;
    expect(client.isRunning).toBe(true);

    await waitFor(() => !client.isRunning, "idle child disposed");
    await waitFor(() => !isProcessAlive(firstPid), "idle child exited");

    const secondPid = (
      (await client.request("test/echo", {})) as { pid: number }
    ).pid;
    expect(secondPid).not.toBe(firstPid);
  });

  it("preserves the engine's numeric error code", async () => {
    const client = createClient();
    try {
      await client.request("test/unknown", {});
      throw new Error("expected the request to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineRequestError);
      expect((error as EngineRequestError).code).toBe(-32601);
    }
  });
});
