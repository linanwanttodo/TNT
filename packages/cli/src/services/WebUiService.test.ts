import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";

import { WebUiService } from "./WebUiService.js";

const { approveSpy, rejectSpy, startDrainingSpy, requestStopSpy } = vi.hoisted(
  () => ({
    approveSpy: vi.fn(() => true),
    rejectSpy: vi.fn(() => true),
    startDrainingSpy: vi.fn(),
    requestStopSpy: vi.fn(),
  }),
);

vi.mock("../permissions/interactionBroker.js", () => ({
  interactionBroker: {
    approve: approveSpy,
    reject: rejectSpy,
    answerQuestion: vi.fn(() => true),
  },
}));

vi.mock("./TurnRunnerService.js", () => ({
  turnRunnerService: {
    startDraining: startDrainingSpy,
    requestStop: requestStopSpy,
    isRunning: vi.fn(() => true),
  },
  RunTurn: {},
}));

vi.mock("../permissions/permissionManager.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../permissions/permissionManager.js")
    >();
  return {
    ...actual,
    toolPermissionManager: {
      getPendingRequestIds: vi.fn(() => []),
      getPendingRequest: vi.fn(() => undefined),
    },
  };
});

const liveServers: http.Server[] = [];

async function started(options: Parameters<WebUiService["start"]>[0] = {}) {
  const handle = await new WebUiService().start({ port: 0, ...options });
  liveServers.push(handle.server);
  // Every route but GET / and POST /webui-session sits behind the token gate,
  // so the suites below authenticate with the header.
  const auth = { authorization: `Bearer ${handle.token}` };
  return { handle, base: `http://127.0.0.1:${handle.port}`, auth };
}

beforeEach(() => {
  approveSpy.mockClear();
  rejectSpy.mockClear();
  startDrainingSpy.mockClear();
  requestStopSpy.mockClear();
  messageQueue.clearMessages();
});

afterEach(() => {
  messageQueue.clearMessages();
});

afterAll(async () => {
  for (const server of liveServers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("WebUiService", () => {
  it("starts a drain loop for a browser message and passes it to runTurn", async () => {
    let releaseTurn: () => void = () => {};
    const turnStarted = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    startDrainingSpy.mockImplementation((runTurn: any) => {
      void (async () => {
        // The loop owns draining; simulate it taking the enqueued message.
        const queued = messageQueue.getNextMessage();
        await runTurn(queued, new AbortController().signal);
        releaseTurn();
      })();
    });

    const { base, auth } = await started({
      runTurn: async (message: QueuedMessage) => {
        expect(message.message).toBe("hello from the browser");
      },
    });

    const response = await fetch(`${base}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "hello from the browser" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { queued: boolean };
    expect(body.queued).toBe(true);

    await vi.waitFor(() => expect(startDrainingSpy).toHaveBeenCalledTimes(1));
    await turnStarted;
  });

  it("enqueues and drains through the default run turn when none is provided", async () => {
    // A plain spy: the queue stays observable, no simulated turn consumes it.
    startDrainingSpy.mockImplementation(() => {});
    const { base, auth } = await started();

    const response = await fetch(`${base}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: "queued only" }),
    });
    expect(response.status).toBe(200);

    // The no-arg call is what wakes an idle TUI whose turn-end drain loop
    // has already exited; it falls back to the registered default pipeline.
    await vi.waitFor(() =>
      expect(startDrainingSpy).toHaveBeenCalledWith(undefined),
    );
    expect(messageQueue.getQueueLength()).toBe(1);
  });

  it("rejects a message without content", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(startDrainingSpy).not.toHaveBeenCalled();
    expect(messageQueue.getQueueLength()).toBe(0);
  });

  it("rejects a non-string message instead of enqueueing it", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ message: { text: "an object" } }),
    });
    expect(response.status).toBe(400);
    expect(messageQueue.getQueueLength()).toBe(0);
  });

  it("serves the token bootstrap page to an unauthenticated request even when a dist exists", async () => {
    // The SPA holds no token exchange of its own: if the dist shell won the
    // unauthenticated GET /, a real browser could never authenticate.
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "webui-dist-"));
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>app</html>");
    try {
      const { base } = await started({ distDir });
      const response = await fetch(base);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("/webui-session");
      expect(body).not.toContain("<html>app</html>");
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("serves the dist app to an authenticated request", async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "webui-dist-"));
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>app</html>");
    try {
      const { base, auth } = await started({ distDir });
      const response = await fetch(base, { headers: auth });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<html>app</html>");
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("answers a pending permission through the interaction broker", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ requestId: "tool-request-7", approved: true }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(approveSpy).toHaveBeenCalledWith("tool-request-7");
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("rejects a permission when approved is false", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ requestId: "tool-request-8", approved: false }),
    });
    expect(response.status).toBe(200);
    expect(rejectSpy).toHaveBeenCalledWith("tool-request-8");
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("answers the broker even when the live query is empty again", async () => {
    const { base, auth } = await started();

    const { toolPermissionManager } =
      await import("../permissions/permissionManager.js");
    const mockedIds = toolPermissionManager.getPendingRequestIds as ReturnType<
      typeof vi.fn
    >;
    const mockedGet = toolPermissionManager.getPendingRequest as ReturnType<
      typeof vi.fn
    >;
    mockedIds.mockReturnValue([]);
    mockedGet.mockReturnValue(undefined);

    const response = await fetch(`${base}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ requestId: "tool-request-404", approved: true }),
    });
    expect(response.status).toBe(200);
    expect(approveSpy).toHaveBeenCalledWith("tool-request-404");
  });

  it("refuses a permission without a requestId", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ approved: true }),
    });
    expect(response.status).toBe(400);
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("calls requestStop on POST /pause", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/pause`, {
      method: "POST",
      headers: auth,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(requestStopSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the state snapshot shape from GET /state", async () => {
    const getSession = vi.fn(() => ({
      sessionId: "session-1",
      title: "Test session",
      workspaceDirectory: process.cwd(),
      history: [],
    }));
    const { base, auth } = await started({ getSession });

    const response = await fetch(`${base}/state`, { headers: auth });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      "isProcessing",
      "messageQueueLength",
      "pendingPermission",
      "session",
    ]);
    expect(body.isProcessing).toBe(true);
    expect((body.session as { sessionId: string }).sessionId).toBe("session-1");
    expect(body.pendingPermission).toBeNull();
    expect(getSession).toHaveBeenCalled();
  });

  it("reports the first pending permission in GET /state", async () => {
    const { base, auth } = await started();

    const { toolPermissionManager } =
      await import("../permissions/permissionManager.js");
    const mockedIds = toolPermissionManager.getPendingRequestIds as ReturnType<
      typeof vi.fn
    >;
    const mockedGet = toolPermissionManager.getPendingRequest as ReturnType<
      typeof vi.fn
    >;
    mockedIds.mockReturnValue(["tool-request-9"]);
    mockedGet.mockReturnValue({
      toolCall: { name: "bash", arguments: { command: "ls" } },
    });

    const response = await fetch(`${base}/state`, { headers: auth });
    const body = (await response.json()) as {
      pendingPermission: { requestId: string; toolName: string } | null;
    };
    expect(body.pendingPermission).toMatchObject({
      requestId: "tool-request-9",
      toolName: "bash",
    });

    mockedIds.mockReset();
    mockedGet.mockReset();
    mockedIds.mockReturnValue([]);
    mockedGet.mockReturnValue(undefined);
  });

  it("streams server-sent events on GET /events", async () => {
    const { base, auth } = await started();

    const controller = new AbortController();
    const response = await fetch(`${base}/events`, {
      headers: auth,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });

  it("serves the missing-dist fallback page on an authenticated GET /", async () => {
    const { base, auth } = await started({
      distDir: path.join(os.tmpdir(), `no-such-dist-${crypto.randomUUID()}`),
    });

    const response = await fetch(`${base}/`, { headers: auth });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("tnt-webui");
    expect(html).toContain("npm install");
  });

  it("answers 404 outside the fallback when a dist is served", async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "webui-dist-"));
    fs.writeFileSync(
      path.join(distDir, "index.html"),
      "<html><body>frontend bundle</body></html>",
    );
    fs.mkdirSync(path.join(distDir, "assets"));
    fs.writeFileSync(
      path.join(distDir, "assets", "app.js"),
      "console.log('app')",
    );

    const { base, auth } = await started({ distDir });

    const root = await fetch(`${base}/`, { headers: auth });
    expect(await root.text()).toContain("frontend bundle");

    const asset = await fetch(`${base}/app/assets/app.js`, {
      headers: auth,
    });
    expect(await asset.text()).toContain("console.log('app')");

    const missing = await fetch(`${base}/no/such/route`, { headers: auth });
    expect(missing.status).toBe(404);
  });

  it("probes to the next port when the requested one is taken", async () => {
    const { handle: blocker } = await started({ port: 0 });

    const { handle } = await started({ port: blocker.port });
    expect(handle.port).toBe(blocker.port + 1);
    expect(handle.token).toEqual(expect.any(String));
    expect(handle.token.length).toBeGreaterThan(0);
  });

  it("gives up with a clear error after the attempt budget", async () => {
    const { handle: blocker } = await started({ port: 0 });
    const occupy = (port: number) =>
      new Promise<http.Server>((resolve) => {
        const server = http.createServer();
        server.listen(port, "127.0.0.1", () => resolve(server));
      });

    const nextOne = await occupy(blocker.port + 1);
    const nextTwo = await occupy(blocker.port + 2);

    await expect(
      new WebUiService().start({
        port: blocker.port,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/could not find a free port/i);

    for (const server of [nextOne, nextTwo]) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("closes the server on close()", async () => {
    const { handle, base } = await started();

    await handle.close();
    await expect(fetch(`${base}/state`)).rejects.toThrow();
  });
});
