import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { ServeHandshake } from "./serveDaemon.js";

const CLI_PATH = fileURLToPath(new URL("../../dist/tnt.js", import.meta.url));
const WAIT_MS = 25_000;

type DaemonChild = ChildProcessByStdio<null, Readable, Readable>;

interface SpawnedDaemon {
  child: DaemonChild;
  stdoutLines: string[];
  stderr: string;
  handshake: ServeHandshake;
  handshakeFile: string;
}

function waitForHandshake(
  child: DaemonChild,
  stdoutLines: string[],
  stderr: () => string,
): Promise<ServeHandshake> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`timed out waiting for handshake\nstderr:\n${stderr()}`));
    }, WAIT_MS);

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    function succeed(handshake: ServeHandshake): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(handshake);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim().length === 0) {
          continue;
        }
        stdoutLines.push(line);
        let parsed: ServeHandshake;
        try {
          parsed = JSON.parse(line) as ServeHandshake;
        } catch {
          fail(new Error(`stdout is not a JSON handshake: ${line}`));
          return;
        }
        if (parsed.type !== "tnt-serve") {
          fail(new Error(`unexpected stdout before handshake: ${line}`));
          return;
        }
        succeed(parsed);
        return;
      }
    });

    child.once("exit", (code, signal) => {
      fail(
        new Error(
          `daemon exited before handshake (code=${code}, signal=${signal})\nstderr:\n${stderr()}`,
        ),
      );
    });
  });
}

function request(
  port: number,
  pathName: string,
  token?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        method: "GET",
        headers:
          token === undefined ? {} : { authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function expectUpgradeRejected(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("timed out waiting for the 401 upgrade response"));
    }, WAIT_MS);

    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      const status = response.statusCode ?? 0;
      socket.terminate();
      resolve(status);
    });
    socket.on("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error("unauthenticated WebSocket upgrade was accepted"));
    });
    socket.on("error", (error) => {
      // `unexpected-response` handles the 401; any earlier error means the
      // socket never reached the server.
      clearTimeout(timer);
      reject(error);
    });
  });
}

function expectUpgradeAccepted(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("timed out waiting for the authenticated upgrade"));
    }, WAIT_MS);

    socket.on("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      const status = response.statusCode ?? 0;
      socket.terminate();
      reject(new Error(`authenticated upgrade was rejected with ${status}`));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function readProcessChildren(pid: number): number[] {
  if (process.platform !== "linux") {
    return [];
  }
  const file = `/proc/${pid}/task/${pid}/children`;
  try {
    return fs
      .readFileSync(file, "utf8")
      .trim()
      .split(/\s+/)
      .filter((value) => value.length > 0)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
}

function collectDescendants(pid: number): number[] {
  const found: number[] = [];
  const queue = readProcessChildren(pid);
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (found.includes(next)) {
      continue;
    }
    found.push(next);
    queue.push(...readProcessChildren(next));
  }
  return found;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForExit(
  child: DaemonChild,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`daemon did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("tnt serve daemon", () => {
  const tempDirs: string[] = [];
  let daemon: SpawnedDaemon | null = null;

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `Missing ${CLI_PATH}. Run \`npm run build:bundle\` before this suite.`,
      );
    }
  });

  afterEach(async () => {
    if (daemon !== null) {
      if (daemon.child.exitCode === null && daemon.child.signalCode === null) {
        daemon.child.kill("SIGKILL");
        await waitForExit(daemon.child, 5000).catch(() => undefined);
      }
      daemon = null;
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function startDaemon(workspace: string): Promise<SpawnedDaemon> {
    const globalDir = makeTempDir("tnt-serve-global-");
    const handshakeFile = path.join(
      makeTempDir("tnt-serve-handshake-"),
      "handshake.json",
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TNT_GLOBAL_DIR: globalDir,
      // Skip the retrieval warm-up the same way the in-process suite does; the
      // daemon's job here is the transport, not an index build.
      VITEST: "true",
    };
    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ]) {
      delete env[name];
    }
    if (env.NO_PROXY === undefined) {
      env.NO_PROXY = "*";
    }

    const child = spawn(
      process.execPath,
      [
        CLI_PATH,
        "serve",
        "--json",
        "--port",
        "0",
        "--workspace",
        workspace,
        "--handshake-file",
        handshakeFile,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const stdoutLines: string[] = [];
    const handshake = await waitForHandshake(child, stdoutLines, () => stderr);
    const spawned: SpawnedDaemon = {
      child,
      stdoutLines,
      stderr,
      handshake,
      handshakeFile,
    };
    daemon = spawned;
    return spawned;
  }

  it("publishes a handshake, gates /ws and /api/server-info, and exits 0 on SIGTERM", async () => {
    const workspace = makeTempDir("tnt-serve-workspace-");
    const spawned = await startDaemon(workspace);
    const { child, handshake } = spawned;

    // Handshake shape.
    expect(handshake.type).toBe("tnt-serve");
    expect(handshake.protocol).toBe(1);
    expect(handshake.pid).toBe(child.pid);
    expect(handshake.port).toBeGreaterThan(0);
    expect(handshake.url).toBe(`http://127.0.0.1:${handshake.port}`);
    expect(handshake.wsUrl).toBe(`ws://127.0.0.1:${handshake.port}/ws`);
    expect(handshake.workspace).toBe(fs.realpathSync(workspace));

    // Exactly one stdout line: the handshake itself.
    expect(spawned.stdoutLines).toHaveLength(1);

    // --handshake-file carries the same document atomically.
    expect(JSON.parse(fs.readFileSync(spawned.handshakeFile, "utf8"))).toEqual(
      handshake,
    );
    if (process.platform !== "win32") {
      expect(fs.statSync(spawned.handshakeFile).mode & 0o777).toBe(0o600);
    }

    // The token is persisted with owner-only permissions.
    const token = fs.readFileSync(handshake.tokenFile, "utf8").trim();
    expect(token.length).toBeGreaterThan(0);
    expect(path.isAbsolute(handshake.tokenFile)).toBe(true);
    expect(path.basename(handshake.tokenFile)).toBe("webui-token");
    if (process.platform !== "win32") {
      expect(fs.statSync(handshake.tokenFile).mode & 0o777).toBe(0o600);
    }

    // Auth gate: no token is rejected, the token reads the workspace.
    const unauthorized = await request(handshake.port, "/api/server-info");
    expect(unauthorized.status).toBe(401);

    const authorized = await request(handshake.port, "/api/server-info", token);
    expect(authorized.status).toBe(200);
    const serverInfo = JSON.parse(authorized.body) as {
      workspaces: Array<{ path: string }>;
    };
    expect(serverInfo.workspaces.map((entry) => entry.path)).toContain(
      handshake.workspace,
    );

    // The /ws upgrade is authenticated before it is accepted.
    expect(await expectUpgradeRejected(handshake.wsUrl)).toBe(401);
    await expectUpgradeAccepted(
      `${handshake.wsUrl}?token=${encodeURIComponent(token)}`,
    );

    // SIGTERM closes the server and exits 0 with no surviving descendants.
    const descendants = collectDescendants(child.pid!);
    child.kill("SIGTERM");
    const exit = await waitForExit(child, WAIT_MS);
    expect(exit.code).toBe(0);
    for (const pid of descendants) {
      expect(processIsAlive(pid), `child ${pid} survived shutdown`).toBe(false);
    }
  });

  it("works without any configured model", async () => {
    const workspace = makeTempDir("tnt-serve-workspace-");
    const spawned = await startDaemon(workspace);
    const { handshake } = spawned;

    // No config.yaml exists under the temp global dir, so this is the
    // unconfigured-model case: the token route and workspace listing must still
    // answer.
    const token = fs.readFileSync(handshake.tokenFile, "utf8").trim();
    const response = await request(handshake.port, "/api/server-info", token);
    expect(response.status).toBe(200);
    expect(response.body).toContain(JSON.stringify(handshake.workspace));

    spawned.child.kill("SIGTERM");
    const exit = await waitForExit(spawned.child, WAIT_MS);
    expect(exit.code).toBe(0);
  });
});
