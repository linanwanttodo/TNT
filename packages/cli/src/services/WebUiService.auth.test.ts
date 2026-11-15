import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { WebUiService } from "./WebUiService.js";

const liveServices: WebUiService[] = [];

async function started(
  options: Parameters<WebUiService["start"]>[0] = {},
): Promise<{
  handle: Awaited<ReturnType<WebUiService["start"]>>;
  base: string;
}> {
  const service = new WebUiService();
  const handle = await service.start({ port: 0, ...options });
  liveServices.push(service);
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

afterEach(async () => {
  for (const service of liveServices.splice(0)) {
    await service.close();
  }
});

afterAll(async () => {
  for (const service of liveServices.splice(0)) {
    await service.close();
  }
});

describe("the WebUiService token gate", () => {
  it("answers 401 when no token is presented", async () => {
    const { base } = await started({ distDir: missingDist() });

    const response = await fetch(`${base}/api/server-info`);
    expect(response.status).toBe(401);
  });

  it("gates every remaining route and the missing-dist catch-all", async () => {
    const { base } = await started({ distDir: missingDist() });

    for (const [method, route] of [
      ["GET", "/api/server-info"],
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

    const response = await fetch(`${base}/api/server-info`, {
      headers: { cookie: `tnt_webui_token=${handle.token}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 200 with a Bearer header", async () => {
    const { handle, base } = await started({
      distDir: missingDist(),
      getSession: emptySession,
    });

    const response = await fetch(`${base}/api/server-info`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 401 for a wrong token", async () => {
    const { handle, base } = await started({ distDir: missingDist() });
    const sameLength = "x".repeat(handle.token.length);
    const short = "x".repeat(4);

    for (const wrong of [sameLength, short]) {
      const asCookie = await fetch(`${base}/api/server-info`, {
        headers: { cookie: `tnt_webui_token=${wrong}` },
      });
      expect(asCookie.status).toBe(401);
      const asBearer = await fetch(`${base}/api/server-info`, {
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
    expect(html).toContain("TNT_WEBUI_DIST");
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

    const state = await fetch(`${base}/api/server-info`, {
      headers: { cookie },
    });
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
