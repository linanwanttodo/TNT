import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, expect, it, vi } from "vitest";

import { flushTransports, resolveLogLevel } from "./logger.js";

describe("resolveLogLevel", () => {
  it("accepts every level the logger knows", () => {
    expect(resolveLogLevel("debug")).toBe("debug");
    expect(resolveLogLevel("info")).toBe("info");
  });

  it("ignores case and surrounding space", () => {
    expect(resolveLogLevel("  DEBUG ")).toBe("debug");
  });

  it("ignores a level it does not know", () => {
    expect(resolveLogLevel("verbose")).toBeUndefined();
    expect(resolveLogLevel("")).toBeUndefined();
    expect(resolveLogLevel(undefined)).toBeUndefined();
  });
});

describe("flushTransports", () => {
  it("waits for a transport that reports done", async () => {
    const close = vi.fn((callback?: () => void) => callback?.());
    let settled = false;

    await flushTransports([{ close }]).then(() => {
      settled = true;
    });

    expect(close).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
  });

  it("resolves when a transport has nothing to close", async () => {
    await expect(flushTransports([{}])).resolves.toBeUndefined();
  });

  it("resolves when closing throws", async () => {
    const close = vi.fn(() => {
      throw new Error("already closed");
    });

    await expect(flushTransports([{ close }])).resolves.toBeUndefined();
  });

  it("gives up on a transport that never reports done", async () => {
    const close = vi.fn();

    await expect(flushTransports([{ close }], 10)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("the log file never appeared"));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("closeLogs", () => {
  it("leaves nothing that can reopen the log file", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-log-close-"));
    const previous = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = home;
    vi.resetModules();

    try {
      const { logger, closeLogs } = await import("./logger.js");
      logger.info("written while the transport is attached");
      // The file transport opens lazily, so the line lands a tick later.
      await waitFor(() => fs.existsSync(path.join(home, "logs", "tnt.log")));

      await closeLogs();
      fs.rmSync(home, { recursive: true, force: true });

      // A transport that is only drained reopens the file on the next line, and
      // the reopened handle is what makes Windows refuse the directory around it.
      logger.warn("written after the close");
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(fs.existsSync(path.join(home, "logs"))).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.TNT_GLOBAL_DIR;
      } else {
        process.env.TNT_GLOBAL_DIR = previous;
      }
      fs.rmSync(home, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
