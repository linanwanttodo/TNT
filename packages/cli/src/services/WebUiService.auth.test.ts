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

import { messageQueue } from "../stream/messageQueue.js";

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

async function started(
  options: Parameters<WebUiService["start"]>[0] = {},
): Promise<{
  handle: Awaited<ReturnType<WebUiService["start"]>>;
  base: string;
}> {
  const handle = await new WebUiService().start({ port: 0, ...options });
  liveServers.push(handle.server);
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

function missingDist(): string {
  return path.join(os.tmpdir(), `no-such-dist-${crypto.randomUUID()}`);
}

const emptySession = () => ({
  sessionId: "session-auth",
  title: "Auth test",
  workspaceDirectory: process.cwd(),
  history: [],
});

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

describe("the WebUiService token gate", () => {
  it("answers 401 when no token is presented", async () => {
    const { base } = await started({ distDir: missingDist() });

    const response = await fetch(`${base}/state`);
    expect(response.status).toBe(401);
  });

  it("gates every engine route and the missing-dist catch-all", async () => {
    const { base } = await started({ distDir: missingDist() });

    for (const [method, route] of [
      ["GET", "/state"],
      ["GET", "/events"],
      ["POST", "/message"],
      ["POST", "/permission"],
      ["POST", "/pause"],
      ["POST", "/exit"],
      ["GET", "/app/shell.js"],
      ["GET", "/any/other/path"],
    ] as const) {
      const response = await fetch(`${base}${route}`, { method });
      expect(response.status, route).toBe(401);
    }
  });

  it("answers 200 with the token cookie", async () => {
    const { handle, base } = await started({
      distDir: missingDist(),
      getSession: emptySession,
    });

    const response = await fetch(`${base}/state`, {
      headers: { cookie: `tnt_webui_token=${handle.token}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 200 with a Bearer header", async () => {
    const { handle, base } = await started({
      distDir: missingDist(),
      getSession: emptySession,
    });

    const response = await fetch(`${base}/state`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 401 for a wrong token", async () => {
    const { handle, base } = await started({ distDir: missingDist() });
    const sameLength = "x".repeat(handle.token.length);
    const short = "x".repeat(4);

    for (const wrong of [sameLength, short]) {
      const asCookie = await fetch(`${base}/state`, {
        headers: { cookie: `tnt_webui_token=${wrong}` },
      });
      expect(asCookie.status).toBe(401);
      const asBearer = await fetch(`${base}/state`, {
        headers: { authorization: `Bearer ${wrong}` },
      });
      expect(asBearer.status).toBe(401);
    }
  });

  it("serves the bootstrap page at GET / without a token", async () => {
    const { handle, base } = await started({ distDir: missingDist() });

    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("/webui-session");
    expect(html).toContain("location.hash");
    // The unauthenticated page must not leak the token it is meant to exchange.
    expect(html).not.toContain(handle.token);
  });

  it("serves the app page at GET / once the cookie is valid", async () => {
    const { handle, base } = await started({ distDir: missingDist() });

    const response = await fetch(`${base}/`, {
      headers: { cookie: `tnt_webui_token=${handle.token}` },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("npm install");
    expect(html).not.toContain("webui-session");
  });

  it("exchanges the token for the session cookie at POST /webui-session", async () => {
    const { handle, base } = await started({
      distDir: missingDist(),
      getSession: emptySession,
    });

    const response = await fetch(`${base}/webui-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: handle.token }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`tnt_webui_token=${handle.token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");

    const state = await fetch(`${base}/state`, { headers: { cookie } });
    expect(state.status).toBe(200);
  });

  it("refuses a wrong token at POST /webui-session", async () => {
    const { base } = await started({ distDir: missingDist() });

    const response = await fetch(`${base}/webui-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "not-the-token" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("persists the token with 0600 permissions in long-lived mode", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "webui-token-"));
    const previous = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = home;
    try {
      const { handle } = await started({
        distDir: missingDist(),
        persistToken: true,
      });

      const file = path.join(home, "webui-token");
      expect(fs.readFileSync(file, "utf8")).toBe(handle.token);
      if (process.platform !== "win32") {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      if (previous === undefined) delete process.env.TNT_GLOBAL_DIR;
      else process.env.TNT_GLOBAL_DIR = previous;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reuses the persisted token across restarts in long-lived mode", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "webui-token-"));
    const previous = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = home;
    try {
      const first = await started({
        distDir: missingDist(),
        persistToken: true,
      });
      const second = await started({
        distDir: missingDist(),
        persistToken: true,
      });

      expect(second.handle.token).toBe(first.handle.token);
      expect(fs.readFileSync(path.join(home, "webui-token"), "utf8")).toBe(
        first.handle.token,
      );
    } finally {
      if (previous === undefined) delete process.env.TNT_GLOBAL_DIR;
      else process.env.TNT_GLOBAL_DIR = previous;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("persists nothing without long-lived mode", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "webui-token-"));
    const previous = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = home;
    try {
      await started({ distDir: missingDist() });

      expect(fs.readdirSync(home)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.TNT_GLOBAL_DIR;
      else process.env.TNT_GLOBAL_DIR = previous;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
