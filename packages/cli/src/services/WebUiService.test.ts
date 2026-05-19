import crypto from "crypto";
import fs from "fs";
import http from "http";
import net from "net";
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

import { subscribeAgentEvents } from "../protocol/eventBus.js";
import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";

import { turnRunnerService } from "./TurnRunnerService.js";
import {
  WebUiService,
  resolveWebUiDist,
  webuiDistCandidates,
} from "./WebUiService.js";

const { approveSpy, rejectSpy, startDrainingSpy, requestStopSpy } = vi.hoisted(
  () => ({
    approveSpy: vi.fn(() => true),
    rejectSpy: vi.fn(() => true),
    startDrainingSpy: vi.fn(),
    requestStopSpy: vi.fn(),
  }),
);

const { listSessionsSpy, startNewSessionSpy, selectSessionSpy } = vi.hoisted(
  () => ({
    listSessionsSpy: vi.fn(async () => [] as unknown[]),
    startNewSessionSpy: vi.fn(),
    selectSessionSpy: vi.fn(() => null as unknown),
  }),
);

vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return {
    ...actual,
    listSessions: listSessionsSpy,
    startNewSession: startNewSessionSpy,
    selectSession: selectSessionSpy,
  };
});

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

  it("serves the dist when its path runs through a dot directory", async () => {
    // The published CLI installs under ~/.tnt, and send() answers 404 for any
    // absolute path containing a dot-prefixed segment unless the file is
    // resolved against a root, so shipping dist inside the package broke the
    // frontend for every install while every /tmp-based test stayed green.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "webui-home-"));
    const distDir = path.join(root, ".tnt", "cli", "package", "dist", "webui");
    fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>app</html>");
    fs.writeFileSync(
      path.join(distDir, "assets", "index.js"),
      "console.log(1)",
    );
    try {
      const { base, auth } = await started({ distDir });
      const shell = await fetch(`${base}/app/`, { headers: auth });
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain("<html>app</html>");
      const asset = await fetch(`${base}/app/assets/index.js`, {
        headers: auth,
      });
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("console.log(1)");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a relative TNT_WEBUI_DIST against the process cwd", async () => {
    // res.sendFile demands an absolute path, so a relative env value must be
    // anchored at startup, not at serve time (express.static tolerates the
    // relative form, which is why the regression only hit GET /).
    const distDir = fs.mkdtempSync(path.join(process.cwd(), "webui-dist-"));
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>app</html>");
    const relative = path.relative(process.cwd(), distDir);
    try {
      const { base, auth } = await started({ distDir: relative });
      const response = await fetch(base, { headers: auth });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<html>app</html>");
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("takes the package's own dist when nothing is configured", () => {
    // The tarball publishes dist/ alone, so the frontend has to be copied to
    // dist/webui at build time; a source checkout keeps the vite output at
    // webui/dist instead. Both sit under the package root, which is found by
    // walking up from the module rather than assumed from the layout, because
    // the bundle and the sources live at different depths.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "webui-pkg-"));
    const moduleDir = path.join(root, "src", "services");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const bundled = path.join(root, "dist", "webui");
    const source = path.join(root, "webui", "dist");
    try {
      expect(webuiDistCandidates(moduleDir, "/cwd")).toEqual([
        bundled,
        source,
        path.resolve("/cwd", "node_modules", "tnt-webui", "dist"),
      ]);

      // Nothing built: the first candidate is reported as the place looked in.
      const empty = resolveWebUiDist(moduleDir, undefined, "/cwd");
      expect(empty.hasDist).toBe(false);
      expect(empty.distDir).toBe(bundled);
      expect(empty.searched).toEqual(webuiDistCandidates(moduleDir, "/cwd"));

      // The source-tree build wins over a hand-installed package.
      fs.mkdirSync(source, { recursive: true });
      expect(resolveWebUiDist(moduleDir, undefined, "/cwd").distDir).toBe(
        source,
      );

      // And the bundled copy outranks it, which is what an installed CLI has.
      fs.mkdirSync(bundled, { recursive: true });
      expect(resolveWebUiDist(moduleDir, undefined, "/cwd").distDir).toBe(
        bundled,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses only the configured directory when one is given", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "webui-pkg-"));
    const moduleDir = path.join(root, "src", "services");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const configured = path.join(root, "elsewhere");
    try {
      const resolved = resolveWebUiDist(moduleDir, configured, "/cwd");
      expect(resolved.distDir).toBe(configured);
      // A deliberate override is not reported against the fallback chain: the
      // page must name the path the operator actually set.
      expect(resolved.searched).toEqual([configured]);
      expect(resolved.hasDist).toBe(false);

      fs.mkdirSync(configured);
      expect(resolveWebUiDist(moduleDir, configured, "/cwd").hasDist).toBe(
        true,
      );

      // An empty override is a slip of the hand, not a request to serve the
      // working directory as a frontend.
      expect(resolveWebUiDist(moduleDir, "", "/cwd").searched).toEqual(
        webuiDistCandidates(moduleDir, "/cwd"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
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
    expect(approveSpy).toHaveBeenCalledWith("tool-request-7", false);
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
    expect(approveSpy).toHaveBeenCalledWith("tool-request-404", false);
  });

  it("forwards a remember answer as the session scope", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        requestId: "tool-request-8",
        approved: true,
        remember: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(approveSpy).toHaveBeenCalledWith("tool-request-8", true);
    expect(rejectSpy).not.toHaveBeenCalled();
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
      "permissionMode",
      "session",
    ]);
    expect(body.isProcessing).toBe(true);
    expect((body.session as { sessionId: string }).sessionId).toBe("session-1");
    expect(body.pendingPermission).toBeNull();
    expect(getSession).toHaveBeenCalled();
  });

  it("reports the current permission mode from GET /state", async () => {
    const { base, auth } = await started();
    const { services } = await import("../services/index.js");
    services.toolPermissions.switchMode("plan");

    const response = await fetch(`${base}/state`, { headers: auth });
    const body = (await response.json()) as { permissionMode: string };
    expect(body.permissionMode).toBe("plan");

    services.toolPermissions.switchMode("default");
  });

  it("switches the permission mode on POST /permission-mode", async () => {
    const { base, auth } = await started();
    const { services } = await import("../services/index.js");

    const response = await fetch(`${base}/permission-mode`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "acceptEdits" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { permissionMode: string };
    expect(body.permissionMode).toBe("acceptEdits");
    expect(services.toolPermissions.getState().currentMode).toBe("acceptEdits");

    services.toolPermissions.switchMode("default");
  });

  it("rejects an unknown permission mode on POST /permission-mode", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/permission-mode`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "sudo" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("mode");
  });

  it("lists the sidebar sessions from GET /sessions", async () => {
    listSessionsSpy.mockResolvedValueOnce([
      {
        sessionId: "session-a",
        title: "First conversation",
        workspaceDirectory: "/work/alpha",
        dateCreated: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        sessionId: "session-b",
        title: "Second conversation",
        workspaceDirectory: "/work/beta",
        dateCreated: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const { base, auth } = await started();

    const response = await fetch(`${base}/sessions`, { headers: auth });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<Record<string, unknown>>;
    };

    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]).toEqual({
      sessionId: "session-a",
      title: "First conversation",
      workspaceDirectory: "/work/alpha",
      dateCreated: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(body.sessions[1]?.updatedAt).toBeUndefined();
    expect(listSessionsSpy).toHaveBeenCalled();
  });

  it("refuses the session routes when the process does not own its session", async () => {
    const { base, auth } = await started();

    const created = await fetch(`${base}/session/new`, {
      method: "POST",
      headers: auth,
    });
    expect(created.status).toBe(403);

    const selected = await fetch(`${base}/session/select`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b" }),
    });
    expect(selected.status).toBe(403);
    expect(startNewSessionSpy).not.toHaveBeenCalled();
    expect(selectSessionSpy).not.toHaveBeenCalled();
  });

  it("starts a new session on POST /session/new and returns its snapshot", async () => {
    const created = {
      sessionId: "session-fresh",
      title: "",
      workspaceDirectory: process.cwd(),
      history: [
        { message: { role: "system", content: "sys" }, contextItems: [] },
      ],
    };
    startNewSessionSpy.mockReturnValueOnce(created);
    const { base, auth } = await started({ ownsSession: true });

    const response = await fetch(`${base}/session/new`, {
      method: "POST",
      headers: auth,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { sessionId: string; title: string };
    };
    expect(body.session.sessionId).toBe("session-fresh");
    expect(startNewSessionSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty sessionId on POST /session/select", async () => {
    const { base, auth } = await started({ ownsSession: true });

    const response = await fetch(`${base}/session/select`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "" }),
    });
    expect(response.status).toBe(400);
    expect(selectSessionSpy).not.toHaveBeenCalled();
  });

  it("answers 404 when the requested session does not exist", async () => {
    selectSessionSpy.mockReturnValueOnce(null);
    const { base, auth } = await started({ ownsSession: true });

    const response = await fetch(`${base}/session/select`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-gone" }),
    });
    expect(response.status).toBe(404);
  });

  it("selects an existing session and returns its snapshot", async () => {
    const selected = {
      sessionId: "session-b",
      title: "Second conversation",
      workspaceDirectory: "/work/beta",
      history: [
        { message: { role: "user", content: "earlier" }, contextItems: [] },
      ],
    };
    selectSessionSpy.mockReturnValueOnce(selected);
    const { base, auth } = await started({ ownsSession: true });

    const response = await fetch(`${base}/session/select`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { sessionId: string; title: string };
    };
    expect(body.session.sessionId).toBe("session-b");
    expect(body.session.title).toBe("Second conversation");
    expect(selectSessionSpy).toHaveBeenCalledWith("session-b");
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
    const missing = path.join(
      os.tmpdir(),
      `no-such-dist-${crypto.randomUUID()}`,
    );
    const { base, auth } = await started({
      distDir: missing,
    });

    const response = await fetch(`${base}/`, { headers: auth });
    expect(response.status).toBe(200);
    const html = await response.text();
    // The page names the path it looked in and the override that would fix it.
    expect(html).toContain(missing);
    expect(html).toContain("TNT_WEBUI_DIST");
    // It must not send the user to the registry: the frontend package is
    // private and was never published, so that install can never succeed.
    expect(html).not.toContain("npm install");
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

  it("does not serve files outside the dist through the /app prefix", async () => {
    // fetch normalizes ".." away, so this goes over a raw socket: the guard
    // must reject sibling dists whose path merely shares the dist's prefix.
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "webui-dist-"));
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>app</html>");
    const siblingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "webui-dist-"));
    fs.writeFileSync(path.join(siblingRoot, "secret.txt"), "escaped");
    try {
      const { handle, base } = await started({ distDir });
      const { port } = handle;
      const token = handle.token;
      const target = path.resolve(siblingRoot).slice(1);
      const raw = `GET /app/../${target}/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`;
      const body = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("error", reject);
        socket.on("connect", () => socket.end(raw));
        let data = "";
        socket.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        socket.on("close", () => resolve(data));
      });
      expect(body).not.toContain("escaped");
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.rmSync(siblingRoot, { recursive: true, force: true });
    }
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

describe("WebUiService model and workspace routes", () => {
  const models = [
    {
      index: 0,
      name: "Deepseek-V4.1-Flash",
      provider: "deepseek",
      current: true,
    },
    { index: 1, name: "gpt-5.2", provider: "openai", current: false },
  ];
  const worktrees = [
    {
      path: "/repo/main",
      branch: "main",
      head: "a".repeat(40),
      detached: false,
      bare: false,
    },
    {
      path: "/repo/side",
      branch: "side",
      head: "b".repeat(40),
      detached: false,
      bare: false,
    },
  ];

  // The module mock answers "a turn is running" because most routes read that
  // to decide whether they may act; these routes need both answers.
  beforeEach(() => {
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(true);
  });
  afterEach(() => {
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(true);
  });

  it("lists the chat models the surface offers on GET /models", async () => {
    const { base, auth } = await started({ listModels: () => models });

    const response = await fetch(`${base}/models`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      models,
      current: models[0],
    });
  });

  it("says there is no model choice when the surface offers none", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/models`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      models: [],
      current: null,
    });
  });

  it("switches the model on POST /model and answers with what is now in use", async () => {
    const switchModel = vi.fn(async () => models[1]);
    const { base, auth } = await started({
      listModels: () => models,
      switchModel,
    });

    const response = await fetch(`${base}/model`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ index: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: models[1] });
    expect(switchModel).toHaveBeenCalledWith(1);
  });

  it("answers a bad model index with the reason the switch gave", async () => {
    const { base, auth } = await started({
      listModels: () => models,
      switchModel: async () => {
        throw new Error("No chat model at index 7 (2 available)");
      },
    });

    const response = await fetch(`${base}/model`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ index: 7 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/index 7/);
  });

  it("needs a number for the model index on POST /model", async () => {
    const { base, auth } = await started({
      listModels: () => models,
      switchModel: vi.fn(),
    });

    const response = await fetch(`${base}/model`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ index: "one" }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses to switch a model the surface never offered", async () => {
    const { base, auth } = await started();

    const response = await fetch(`${base}/model`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ index: 0 }),
    });
    expect(response.status).toBe(403);
  });

  it("lists the repository's checkouts on GET /worktrees", async () => {
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
    });

    const response = await fetch(`${base}/worktrees`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      worktrees,
      current: worktrees[0],
      switchable: true,
    });
  });

  it("says the workspace has no other checkout when the process is hosted", async () => {
    const { base, auth } = await started({
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
    });

    const response = await fetch(`${base}/worktrees`, { headers: auth });
    expect(await response.json()).toMatchObject({ switchable: false });
  });

  it("says the workspace is not a repository when there is nothing to list", async () => {
    const { base, auth } = await started({
      listWorktrees: () => [],
      currentWorktree: () => null,
    });

    const response = await fetch(`${base}/worktrees`, { headers: auth });
    expect(await response.json()).toEqual({
      available: false,
      worktrees: [],
      current: null,
      switchable: false,
    });
  });

  it("moves the session's workspace on POST /worktree when the process owns it", async () => {
    const switchWorktree = vi.fn(async () => worktrees[1]);
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(false);
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree,
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/repo/side" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worktree: worktrees[1] });
    expect(switchWorktree).toHaveBeenCalledWith("/repo/side");
  });

  it("refuses to move a server that does not own its session", async () => {
    const switchWorktree = vi.fn();
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(false);
    const { base, auth } = await started({
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree,
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/repo/side" }),
    });
    expect(response.status).toBe(403);
    expect(switchWorktree).not.toHaveBeenCalled();
  });

  it("waits for the running turn before moving the workspace", async () => {
    const switchWorktree = vi.fn();
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree,
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/repo/side" }),
    });
    expect(response.status).toBe(409);
    expect(switchWorktree).not.toHaveBeenCalled();
  });

  it("refuses to move into a directory the repository does not have", async () => {
    const switchWorktree = vi.fn();
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(false);
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree,
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/somewhere/else" }),
    });
    expect(response.status).toBe(400);
    expect(switchWorktree).not.toHaveBeenCalled();
  });

  it("reports the failure when the move itself goes wrong", async () => {
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(false);
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree: async () => {
        throw new Error("the directory vanished");
      },
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/repo/side" }),
    });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/vanished/);
  });

  it("tells every open tab about the workspace the browser moved", async () => {
    const events: string[] = [];
    const unsubscribe = subscribeAgentEvents((event) => {
      events.push(event.type);
    });
    vi.mocked(turnRunnerService.isRunning).mockReturnValue(false);
    const { base, auth } = await started({
      ownsSession: true,
      listWorktrees: () => worktrees,
      currentWorktree: () => worktrees[0],
      switchWorktree: async () => worktrees[1],
    });

    const response = await fetch(`${base}/worktree`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: "/repo/side" }),
    });
    unsubscribe();

    expect(response.status).toBe(200);
    expect(events).toContain("workspace.changed");
  });

  it("tells every open tab about the model the browser chose", async () => {
    const events: string[] = [];
    const unsubscribe = subscribeAgentEvents((event) => {
      events.push(event.type);
    });
    const { base, auth } = await started({
      listModels: () => models,
      switchModel: async () => models[1],
    });

    const response = await fetch(`${base}/model`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ index: 1 }),
    });
    unsubscribe();

    expect(response.status).toBe(200);
    expect(events).toContain("model.changed");
  });

  it("reports the context breakdown from the getContextBreakdown seam", async () => {
    const breakdown = {
      usedTokens: 1200,
      contextLimit: 100_000,
      freeTokens: 98_800,
      percentUsed: 1,
      categories: {
        systemPrompt: 400,
        tools: 300,
        conversation: 300,
        toolResults: 100,
        contextItems: 100,
      },
    };
    const { base, auth } = await started({
      getContextBreakdown: () => breakdown,
    });

    const response = await fetch(`${base}/context`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(breakdown);
  });

  it("requires authentication for GET /context", async () => {
    const { base } = await started({
      getContextBreakdown: () => ({
        usedTokens: 0,
        contextLimit: 200_000,
        freeTokens: 200_000,
        percentUsed: 0,
        categories: {
          systemPrompt: 0,
          tools: 0,
          conversation: 0,
          toolResults: 0,
          contextItems: 0,
        },
      }),
    });

    const response = await fetch(`${base}/context`);
    expect(response.status).toBe(401);
  });
});
