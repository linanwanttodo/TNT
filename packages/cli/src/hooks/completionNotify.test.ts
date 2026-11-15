import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildNotifyPayload,
  configuredNotifyCommand,
  runCompletionNotify,
} from "./completionNotify.js";

describe("configuredNotifyCommand", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-notify-"));
  const home = path.join(dir, "home");

  function writeSettings(cwd: string, value: unknown) {
    const settingsDir = path.join(cwd, ".tnt");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ notify: value }),
    );
  }

  it("returns undefined when no settings file declares notify", () => {
    const cwd = fs.mkdtempSync(path.join(dir, "empty-"));
    expect(configuredNotifyCommand(cwd, home)).toBeUndefined();
  });

  it("reads the command list from the project settings file", () => {
    const cwd = fs.mkdtempSync(path.join(dir, "project-"));
    writeSettings(cwd, ["say", "done"]);
    expect(configuredNotifyCommand(cwd, home)).toEqual(["say", "done"]);
  });

  it("ignores a value that is not a list of strings", () => {
    const cwd = fs.mkdtempSync(path.join(dir, "bad-"));
    writeSettings(cwd, { command: "say" });
    expect(configuredNotifyCommand(cwd, home)).toBeUndefined();
  });

  it("drops empty entries", () => {
    const cwd = fs.mkdtempSync(path.join(dir, "spaces-"));
    writeSettings(cwd, ["say", "  ", ""]);
    expect(configuredNotifyCommand(cwd, home)).toEqual(["say"]);
  });
});

describe("runCompletionNotify", () => {
  it("appends the payload as the final argument", async () => {
    const child = new EventEmitter() as any;
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const calls: string[][] = [];
    const tracked = vi.fn((executable: string, args: string[]) => {
      calls.push([executable, ...args]);
      return spawnFn();
    }) as any;

    await runCompletionNotify("all done", {
      command: ["say", "-v", "Alex"],
      spawnFn: tracked,
    });

    expect(calls).toEqual([
      [
        "say",
        "-v",
        "Alex",
        expect.stringContaining('"type":"agent-turn-complete"'),
      ],
    ]);
    const payload = JSON.parse(calls[0][calls[0].length - 1]);
    expect(payload.type).toBe("agent-turn-complete");
    expect(payload.lastAssistantMessage).toBe("all done");
    expect(typeof payload.sessionId).toBe("string");
  });

  it("does nothing when no command is configured", async () => {
    const spawnFn = vi.fn();
    await runCompletionNotify("done", { command: [], spawnFn: spawnFn as any });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("survives a command that cannot start", async () => {
    const child = new EventEmitter() as any;
    child.kill = vi.fn();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    }) as any;

    await expect(
      runCompletionNotify("done", { command: ["nope"], spawnFn }),
    ).resolves.toBeUndefined();
  });

  it("survives a synchronous spawn failure", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("bad options");
    }) as any;

    await expect(
      runCompletionNotify("done", { command: ["nope"], spawnFn }),
    ).resolves.toBeUndefined();
  });

  it("stops a command that never exits instead of hanging the run", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as any;
      child.kill = vi.fn();
      const spawnFn = vi.fn(() => child) as any;

      const pending = runCompletionNotify("done", {
        command: ["slow"],
        spawnFn,
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toBeUndefined();
      expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildNotifyPayload", () => {
  it("names the event the way the notifier contract does", () => {
    expect(buildNotifyPayload("the answer", "session-1")).toEqual({
      type: "agent-turn-complete",
      sessionId: "session-1",
      lastAssistantMessage: "the answer",
    });
  });
});
