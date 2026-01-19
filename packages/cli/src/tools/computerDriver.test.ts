import { describe, expect, it, vi } from "vitest";

import {
  detectComputerBackend,
  parseKeyCombo,
  type CommandRunner,
} from "./computerDriver.js";

function runner(buffer = Buffer.from("")): CommandRunner & {
  calls: Array<{ file: string; args: string[]; input?: string | Buffer }>;
} {
  const calls: Array<{
    file: string;
    args: string[];
    input?: string | Buffer;
  }> = [];
  return {
    calls,
    run: async (file, args, input) => {
      calls.push({ file, args, input });
      return buffer;
    },
  };
}

const linux = (env: NodeJS.ProcessEnv = { DISPLAY: ":1" }) =>
  detectComputerBackend({
    platform: "linux",
    env,
    runner: runner(),
    hasCommand: () => true,
  });

describe("parseKeyCombo", () => {
  it("accepts modifiers, characters and named keys", () => {
    expect(parseKeyCombo("ctrl+shift+t")).toEqual(["ctrl", "shift", "t"]);
    expect(parseKeyCombo("Control+F5")).toEqual(["ctrl", "F5"]);
    expect(parseKeyCombo("Return")).toEqual(["Return"]);
  });

  it("refuses anything that is not a key", () => {
    for (const bad of ["--help", "ctrl+;", "super+rm -rf", ""]) {
      expect(() => parseKeyCombo(bad), bad).toThrow();
    }
  });
});

describe("Linux backend", () => {
  it("captures through import and drives the pointer with xdotool", async () => {
    const commands = runner();
    const backend = detectComputerBackend({
      platform: "linux",
      env: { DISPLAY: ":1" },
      runner: commands,
      hasCommand: () => true,
    });

    await backend.capture();
    await backend.move({ x: 10, y: 20 });
    await backend.click({ x: 1, y: 2 }, "right", 2);
    await backend.drag({ x: 1, y: 2 }, { x: 30, y: 40 }, "left");
    await backend.type("hello; rm -rf /");
    await backend.key("ctrl+t");
    await backend.scroll("up", 3, { x: 5, y: 6 });

    expect(commands.calls).toEqual([
      { file: "import", args: ["-window", "root", "png:-"], input: undefined },
      {
        file: "xdotool",
        args: ["mousemove", "--sync", "10", "20"],
        input: undefined,
      },
      {
        file: "xdotool",
        args: ["mousemove", "--sync", "1", "2", "click", "--repeat", "2", "3"],
        input: undefined,
      },
      {
        file: "xdotool",
        args: [
          "mousemove",
          "--sync",
          "1",
          "2",
          "mousedown",
          "1",
          "mousemove",
          "--sync",
          "30",
          "40",
          "mouseup",
          "1",
        ],
        input: undefined,
      },
      {
        file: "xdotool",
        args: ["type", "--clearmodifiers", "--file", "-"],
        input: "hello; rm -rf /",
      },
      {
        file: "xdotool",
        args: ["key", "--clearmodifiers", "ctrl+t"],
        input: undefined,
      },
      {
        file: "xdotool",
        args: ["mousemove", "--sync", "5", "6", "click", "--repeat", "3", "4"],
        input: undefined,
      },
    ]);
  });

  it("reads the pointer position from the shell output", async () => {
    const backend = detectComputerBackend({
      platform: "linux",
      env: { DISPLAY: ":1" },
      runner: runner(Buffer.from("X=12\nY=34\nWINDOW=1\n")),
      hasCommand: () => true,
    });

    await expect(backend.cursorPosition()).resolves.toEqual({ x: 12, y: 34 });
  });

  it("prefers grim for capture on Wayland", async () => {
    const commands = runner();
    const backend = detectComputerBackend({
      platform: "linux",
      env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":1" },
      runner: commands,
      hasCommand: () => true,
    });

    expect(backend.platform).toBe("linux-wayland");
    await backend.capture();
    expect(commands.calls[0]).toMatchObject({
      file: "grim",
      args: ["-t", "png", "-"],
    });
  });

  it("explains which binary is missing", () => {
    expect(() =>
      detectComputerBackend({
        platform: "linux",
        env: { DISPLAY: ":1" },
        hasCommand: (name) => name !== "xdotool",
      }),
    ).toThrow(/xdotool/);

    expect(() =>
      detectComputerBackend({
        platform: "linux",
        env: { DISPLAY: ":1" },
        hasCommand: (name) => name === "xdotool",
      }),
    ).toThrow(/grim|import/);
  });

  it("refuses a session with no display", () => {
    expect(() => linux({})).toThrow(/DISPLAY/);
  });
});

describe("other platforms", () => {
  it("refuses Windows with a product-level reason", () => {
    expect(() =>
      detectComputerBackend({ platform: "win32", hasCommand: () => true }),
    ).toThrow(/not implemented on Windows/);
  });

  it("names the macOS pointer dependency", () => {
    expect(() =>
      detectComputerBackend({
        platform: "darwin",
        hasCommand: () => false,
      }),
    ).toThrow(/cliclick/);
  });

  it("builds cliclick and System Events commands on macOS", async () => {
    const commands = runner();
    const backend = detectComputerBackend({
      platform: "darwin",
      env: {},
      runner: commands,
      hasCommand: () => true,
    });

    await backend.move({ x: 1, y: 2 });
    await backend.click({ x: 3, y: 4 }, "left", 2);
    await backend.drag({ x: 1, y: 1 }, { x: 9, y: 9 }, "left");
    await backend.type("hi");
    await backend.key("ctrl+Return");

    expect(commands.calls).toEqual([
      { file: "cliclick", args: ["m:1,2"], input: undefined },
      { file: "cliclick", args: ["dc:3,4"], input: undefined },
      {
        file: "cliclick",
        args: ["dd:1,1", "dm:9,9", "du:9,9"],
        input: undefined,
      },
      {
        file: "osascript",
        args: ["-e", 'tell application "System Events" to keystroke "hi"'],
        input: undefined,
      },
      {
        file: "osascript",
        args: [
          "-e",
          'tell application "System Events" to key code 36 using {control down}',
        ],
        input: undefined,
      },
    ]);
  });

  it("does not pretend to scroll on macOS", async () => {
    const backend = detectComputerBackend({
      platform: "darwin",
      env: {},
      runner: runner(),
      hasCommand: () => true,
    });

    await expect(backend.scroll("down", 1)).rejects.toThrow(/page_down/);
  });
});

describe("command probing", () => {
  it("does not spawn a probe when the dependency is missing", () => {
    const run = vi.fn();
    expect(() =>
      detectComputerBackend({
        platform: "linux",
        env: { DISPLAY: ":1" },
        runner: { run },
        hasCommand: () => false,
      }),
    ).toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
