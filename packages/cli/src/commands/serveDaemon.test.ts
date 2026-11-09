import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildServeHandshake,
  isServeDaemonMode,
  parseDaemonPort,
  resolveDaemonWorkspace,
  SERVE_PROTOCOL_VERSION,
  writeHandshakeFile,
} from "./serveDaemon.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isServeDaemonMode", () => {
  it("selects the daemon only when a daemon flag is present", () => {
    expect(isServeDaemonMode({})).toBe(false);
    expect(isServeDaemonMode({ tui: true })).toBe(false);
    expect(isServeDaemonMode({ json: true })).toBe(true);
    expect(isServeDaemonMode({ handshakeFile: "/tmp/handshake.json" })).toBe(
      true,
    );
    expect(isServeDaemonMode({ workspace: "/tmp/ws" })).toBe(true);
    expect(isServeDaemonMode({ tui: false })).toBe(true);
  });
});

describe("parseDaemonPort", () => {
  it("defaults to an ephemeral port when omitted", () => {
    expect(parseDaemonPort(undefined)).toEqual({ ok: true, port: 0 });
  });

  it("accepts port 0 and the full range", () => {
    expect(parseDaemonPort("0")).toEqual({ ok: true, port: 0 });
    expect(parseDaemonPort("47610")).toEqual({ ok: true, port: 47610 });
    expect(parseDaemonPort("65535")).toEqual({ ok: true, port: 65535 });
    expect(parseDaemonPort(8080)).toEqual({ ok: true, port: 8080 });
  });

  it("rejects out-of-range and non-numeric values", () => {
    for (const raw of ["-1", "65536", "abc", "1.5", ""]) {
      const result = parseDaemonPort(raw);
      expect(result.ok, raw).toBe(false);
    }
  });
});

describe("resolveDaemonWorkspace", () => {
  it("returns the real absolute path of an existing directory", () => {
    const dir = makeTempDir("tnt-serve-workspace-");
    expect(resolveDaemonWorkspace(dir)).toBe(fs.realpathSync(dir));
  });

  it("refuses a path that is not a directory", () => {
    const dir = makeTempDir("tnt-serve-workspace-");
    const file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "x");
    expect(() => resolveDaemonWorkspace(file)).toThrow(/not a directory/);
    expect(() => resolveDaemonWorkspace(path.join(dir, "missing"))).toThrow();
  });
});

describe("buildServeHandshake", () => {
  it("emits the documented wire shape", () => {
    const handshake = buildServeHandshake({
      port: 43210,
      workspace: "/tmp/workspace",
      tokenFile: "/tmp/global/webui-token",
    });
    expect(handshake).toEqual({
      type: "tnt-serve",
      protocol: SERVE_PROTOCOL_VERSION,
      pid: process.pid,
      port: 43210,
      url: "http://127.0.0.1:43210",
      wsUrl: "ws://127.0.0.1:43210/ws",
      tokenFile: "/tmp/global/webui-token",
      workspace: "/tmp/workspace",
    });
    expect(handshake.protocol).toBe(1);
  });
});

describe("writeHandshakeFile", () => {
  it("writes the JSON atomically with owner-only permissions", () => {
    const dir = makeTempDir("tnt-serve-handshake-");
    const file = path.join(dir, "handshake.json");
    const handshake = buildServeHandshake({
      port: 1,
      workspace: dir,
      tokenFile: path.join(dir, "webui-token"),
    });

    writeHandshakeFile(file, handshake);

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(handshake);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("creates a missing parent directory and replaces an existing file", () => {
    const dir = makeTempDir("tnt-serve-handshake-");
    const file = path.join(dir, "nested", "handshake.json");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "stale");

    const handshake = buildServeHandshake({
      port: 2,
      workspace: dir,
      tokenFile: path.join(dir, "webui-token"),
    });
    writeHandshakeFile(file, handshake);

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(handshake);
  });
});
