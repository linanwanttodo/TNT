import { readFileSync } from "fs";
import * as net from "net";
import { join } from "path";
import { fileURLToPath } from "url";

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

// The e2e config runs from this package, but the path is derived from the file so the
// spec it reads cannot depend on which directory a runner happened to start in.
const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

  it("binds no narrower than the wire-format spec says it does", async () => {
    await waitFor("GET /state to answer", async () => {
      const state = await get("/state");
      return state.status === 200 ? state : undefined;
    });

    // Measured on this box: the unauthenticated server answers `/state` on every
    // non-loopback IPv4 it has (a LAN address included), because `serve.ts` calls
    // `app.listen(port, …)` with no host. So "localhost only" cannot be written in the
    // spec while this stays true, and if the default is ever narrowed to loopback this
    // case is the thing that says the document may now say so - the two cannot drift.
    const os = await import("os");
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry!.address);
    if (addresses.length === 0) return; // nothing to probe beside loopback

    const port = new URL(baseUrl).port;
    let reachable = false;
    for (const address of addresses) {
      try {
        const response = await fetch(`http://${address}:${port}/state`);
        if (response.status === 200) reachable = true;
      } catch {
        // refused or filtered on this address; the next one decides
      }
    }

    const spec = readFileSync(
      join(packageRoot, "spec", "wire-format.md"),
      "utf-8",
    );
    const claimsLoopbackOnly = /binds to `127\.0\.0\.1`|localhost only/i.test(
      spec,
    );
    expect(reachable).toBe(!claimsLoopbackOnly);
  }, 60000);
});
