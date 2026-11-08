import crypto from "crypto";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  WebUiService,
  resolveWebUiDist,
  webuiDistCandidates,
} from "./WebUiService.js";

const liveServices: WebUiService[] = [];

async function started(options: Parameters<WebUiService["start"]>[0] = {}) {
  const service = new WebUiService();
  const handle = await service.start({ port: 0, ...options });
  liveServices.push(service);
  // GET / and POST /webui-session are the only ungated shapes, so the suites
  // below authenticate with the header.
  const auth = { authorization: `Bearer ${handle.token}` };
  return { handle, base: `http://127.0.0.1:${handle.port}`, auth };
}

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

describe("WebUiService static serving", () => {
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

  it("takes the vendored web build when nothing is configured", () => {
    // The tarball publishes dist/ alone, so the frontend is copied to
    // dist/webui at build time. A source checkout prefers the vendored build
    // under packages/zcode-ui, which sits beside the CLI package rather than
    // inside it; the package root is found by walking up from the module
    // rather than assumed from the layout, because the bundle and the sources
    // live at different depths.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "webui-pkg-"));
    const packageRoot = path.join(root, "packages", "cli");
    const moduleDir = path.join(packageRoot, "src", "services");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), "{}");
    const vendored = path.join(root, "packages", "zcode-ui", "web", "dist");
    const bundled = path.join(packageRoot, "dist", "webui");
    try {
      expect(webuiDistCandidates(moduleDir, "/cwd")).toEqual([
        vendored,
        bundled,
        path.resolve("/cwd", "node_modules", "tnt-webui", "dist"),
      ]);

      // Nothing built: the first candidate is reported as the place looked in.
      const empty = resolveWebUiDist(moduleDir, undefined, "/cwd");
      expect(empty.hasDist).toBe(false);
      expect(empty.distDir).toBe(vendored);
      expect(empty.searched).toEqual(webuiDistCandidates(moduleDir, "/cwd"));

      // The bundled copy serves an installed CLI, which has no vendor tree.
      fs.mkdirSync(bundled, { recursive: true });
      expect(resolveWebUiDist(moduleDir, undefined, "/cwd").distDir).toBe(
        bundled,
      );

      // A source checkout prefers the live vendored build over that copy.
      fs.mkdirSync(vendored, { recursive: true });
      expect(resolveWebUiDist(moduleDir, undefined, "/cwd").distDir).toBe(
        vendored,
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
      const { handle } = await started({ distDir });
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
    await expect(fetch(`${base}/api/server-info`)).rejects.toThrow();
  });
});

describe("WebUiService server-info route", () => {
  const sessionAt = (workspaceDirectory: string) => () => ({
    sessionId: "session-info",
    title: "",
    workspaceDirectory,
    history: [],
  });

  it("answers the workspace shape the vendored ZCode entry reads", async () => {
    // The entry takes workspaces[0].path as its initial workspace. A trailing
    // separator must not survive, and the session's cwd duplicate collapses.
    const { base, auth } = await started({
      getSession: sessionAt(`${process.cwd()}${path.sep}`),
    });

    const response = await fetch(`${base}/api/server-info`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspaces: [
        {
          path: process.cwd(),
          name: process.cwd().split("/").pop(),
        },
      ],
    });
  });

  it("requires authentication for GET /api/server-info", async () => {
    const { base } = await started();

    const response = await fetch(`${base}/api/server-info`);
    expect(response.status).toBe(401);
  });
});
