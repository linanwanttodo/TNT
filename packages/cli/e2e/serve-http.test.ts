import * as net from "net";
import * as os from "os";

import { execaNode } from "execa";

import {
  cleanupTestContext,
  createTestContext,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * `tnt serve` is the surface other tools drive, and nothing ran it over HTTP: the
 * route table, the turn it runs for a posted message and the /exit shutdown were
 * only asserted piecemeal through their helpers. This boots the built CLI, talks
 * to it with real requests, and stops it with /exit - the endpoint whose own test
 * had been a stub asserting `true`.
 */
describe("E2E: the serve HTTP surface", () => {
  let context: any;
  let mockServer: MockLLMServer;
  let child: ReturnType<typeof execaNode> | undefined;
  let baseUrl = "";

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (!address || typeof address === "string") {
          reject(new Error("no port"));
          return;
        }
        const { port } = address;
        probe.close(() => resolve(port));
      });
    });
  }

  async function get(path: string): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`);
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: text };
    }
  }

  async function post(
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: text };
    }
  }

  async function waitFor<T>(
    describe: string,
    probe: () => Promise<T | undefined>,
    timeoutMs = 20000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (child?.exitCode !== null && child?.exitCode !== undefined) {
        throw new Error(
          `${describe}: the server exited early (${child.exitCode})\n${child.stderr?.toString?.() ?? ""}`,
        );
      }
      const value = await probe().catch(() => undefined);
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`${describe}: timed out`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "served hello",
    });
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;

    child = execaNode(
      context.cliPath,
      ["serve", "--config", context.configPath, "--port", String(port)],
      {
        cwd: context.testDir,
        env: {
          ...process.env,
          CONTINUE_CLI_TEST: "true",
          HOME: context.testDir,
          CONTINUE_GLOBAL_DIR: context.testDir + "/.tnt",
        },
        reject: false,
      },
    );
  });

  afterEach(async () => {
    if (child && child.exitCode === null && child.pid) {
      // Only the process this test started.
      child.kill("SIGKILL");
    }
    child = undefined;
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("accepts a message, runs the turn, and stops on /exit", async () => {
    await waitFor("GET /state to answer", async () => {
      const state = await get("/state");
      return state.status === 200 ? state : undefined;
    });

    const posted = await post("/message", { message: "Say hello" });
    expect(posted.status).toBe(200);

    // The turn ran through the real engine: the mock provider's answer lands in
    // the state the endpoint serves.
    await waitFor("the assistant answer to appear in /state", async () => {
      const state = await get("/state");
      return JSON.stringify(state.body).includes("served hello")
        ? state
        : undefined;
    });
    expect(mockServer.requests.length).toBeGreaterThan(0);

    // Outside a repository the route says so rather than failing anonymously.
    const diff = await get("/diff");
    expect(diff.status).toBe(404);
    expect(String(diff.body.error ?? diff.body)).toContain("git");

    const exited = await post("/exit");
    expect(exited.status).toBe(200);

    const finished = await child;
    const exitCode = finished?.exitCode;
    if (exitCode === undefined || exitCode === null) {
      throw new Error(
        `the server did not stop after /exit\n${finished?.stderr ?? "no output"}`,
      );
    }
    expect(exitCode).toBe(0);
  }, 60000);

  it("answers the two control endpoints it documents", async () => {
    await waitFor("GET /state to answer", async () => {
      const state = await get("/state");
      return state.status === 200 ? state : undefined;
    });

    // `spec/wire-format.md` describes these two from the handler, and nothing else in
    // the package calls them, so this is the only place they are actually executed.
    // Idle, they refuse rather than pretend: nothing to pause, nothing to answer.
    const paused = await post("/pause");
    expect(paused.status).toBe(200);
    expect(paused.body.success).toBe(false);
    expect(String(paused.body.message)).toContain(
      "No active processing to pause",
    );

    const permission = await post("/permission", {
      requestId: "req-none",
      approved: true,
    });
    expect(permission.status).toBe(400);
    expect(String(permission.body.error)).toContain(
      "No pending permission request",
    );

    const exited = await post("/exit");
    expect(exited.status).toBe(200);
  }, 60000);

  it("binds loopback only by default", async () => {
    await waitFor("GET /state to answer", async () => {
      const state = await get("/state");
      return state.status === 200 ? state : undefined;
    });

    // The default is loopback because this server is unauthenticated. If any
    // non-loopback address answers here, the default widened without anyone saying so.
    const addresses = nonLoopbackAddresses();
    if (addresses.length === 0) return;
    const port = new URL(baseUrl).port;
    const reachable: string[] = [];
    for (const address of addresses) {
      try {
        const response = await fetch(`http://${address}:${port}/state`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.status === 200) reachable.push(address);
      } catch {
        // refused or filtered: the expected answer everywhere beside loopback
      }
    }
    expect(reachable).toEqual([]);
  }, 60000);

  it("reaches a non-loopback address when --host asks for it", async () => {
    const addresses = nonLoopbackAddresses();
    if (addresses.length === 0) return;

    // The documented escape hatch; without it the loopback default would make serve
    // unreachable from another container.
    child?.kill("SIGKILL");
    await child;
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = execaNode(
      context.cliPath,
      [
        "serve",
        "--config",
        context.configPath,
        "--port",
        String(port),
        "--host",
        "0.0.0.0",
      ],
      {
        cwd: context.testDir,
        env: {
          ...process.env,
          CONTINUE_CLI_TEST: "true",
          HOME: context.testDir,
          CONTINUE_GLOBAL_DIR: context.testDir + "/.tnt",
        },
        reject: false,
      },
    );

    await waitFor("GET /state to answer on loopback", async () => {
      const state = await get("/state");
      return state.status === 200 ? state : undefined;
    });

    const statuses = await Promise.all(
      addresses.map(async (address) => {
        try {
          const response = await fetch(`http://${address}:${port}/state`, {
            signal: AbortSignal.timeout(1500),
          });
          return response.status;
        } catch {
          return 0;
        }
      }),
    );
    expect(statuses).toContain(200);
  }, 90000);
});

function nonLoopbackAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address);
}
