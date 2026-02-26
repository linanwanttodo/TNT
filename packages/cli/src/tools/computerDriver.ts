import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { TntError, TntErrorReason } from "core/util/errors.js";

export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";

export interface CommandRunner {
  /** Runs a binary without a shell and returns its stdout bytes. */
  run(file: string, args: string[], input?: string | Buffer): Promise<Buffer>;
}

/**
 * Every action is one binary and an argument list. The text being typed goes
 * through stdin, never through an argument, so a shell metacharacter in it is
 * just a character.
 */
export const execRunner: CommandRunner = {
  run(file, args, input) {
    return new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        file,
        args,
        { encoding: "buffer", timeout: 15_000, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const detail = Buffer.from(stderr ?? "")
              .toString("utf8")
              .trim();
            reject(
              new TntError(
                TntErrorReason.Unspecified,
                `${path.basename(file)} failed: ${detail || error.message}`,
              ),
            );
            return;
          }
          resolve(Buffer.from(stdout));
        },
      );
      if (input !== undefined) {
        child.stdin?.end(input);
      }
    });
  },
};

export function commandExists(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const pathValue = env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  return pathValue.split(path.delimiter).some((dir) =>
    extensions.some((extension) => {
      try {
        return fs.existsSync(path.join(dir, `${command}${extension}`));
      } catch {
        return false;
      }
    }),
  );
}

const XDOTOOL_BUTTON: Record<MouseButton, string> = {
  left: "1",
  right: "3",
  middle: "2",
};

const WHEEL_BUTTON: Record<ScrollDirection, string> = {
  up: "4",
  down: "5",
  left: "6",
  right: "7",
};

const MODIFIERS = new Set([
  "ctrl",
  "control",
  "alt",
  "shift",
  "super",
  "meta",
  "cmd",
]);

const NAMED_KEYS = new Set([
  "return",
  "enter",
  "escape",
  "esc",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "page_up",
  "page_down",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
]);

/**
 * A key combination is split and checked before it reaches the driver. Passing
 * an unchecked token would let a model hand xdotool an option or a command
 * separator; a whitelist keeps the call to keys and modifiers only.
 */
export function parseKeyCombo(raw: string): string[] {
  const tokens = raw
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "A keypress needs at least one key, for example ctrl+shift+t.",
    );
  }
  return tokens.map((token) => {
    const lower = token.toLowerCase();
    if (MODIFIERS.has(lower)) {
      return lower === "control" ? "ctrl" : lower;
    }
    if (NAMED_KEYS.has(lower) || /^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) {
      return token;
    }
    if (/^[a-z0-9]$/i.test(token)) {
      return token;
    }
    throw new TntError(
      TntErrorReason.Unspecified,
      `Unsupported key "${token}". Use a letter, a digit, F1-F24 or a named key.`,
    );
  });
}

export interface Point {
  x: number;
  y: number;
}

export interface ComputerBackend {
  readonly platform: string;
  capture(): Promise<Buffer>;
  move(point: Point): Promise<void>;
  click(point: Point, button: MouseButton, count: number): Promise<void>;
  drag(from: Point, to: Point, button: MouseButton): Promise<void>;
  type(text: string): Promise<void>;
  key(combo: string): Promise<void>;
  scroll(direction: ScrollDirection, amount: number, at?: Point): Promise<void>;
  cursorPosition(): Promise<Point>;
}

class X11Backend implements ComputerBackend {
  readonly platform: string;

  constructor(
    private readonly runner: CommandRunner,
    private readonly captureWith: "import" | "grim",
  ) {
    this.platform = captureWith === "grim" ? "linux-wayland" : "linux-x11";
  }

  async capture(): Promise<Buffer> {
    return this.captureWith === "grim"
      ? this.runner.run("grim", ["-t", "png", "-"])
      : this.runner.run("import", ["-window", "root", "png:-"]);
  }

  async move(point: Point): Promise<void> {
    await this.runner.run("xdotool", [
      "mousemove",
      "--sync",
      `${point.x}`,
      `${point.y}`,
    ]);
  }

  async click(point: Point, button: MouseButton, count: number): Promise<void> {
    await this.runner.run("xdotool", [
      "mousemove",
      "--sync",
      `${point.x}`,
      `${point.y}`,
      "click",
      "--repeat",
      `${count}`,
      XDOTOOL_BUTTON[button],
    ]);
  }

  async drag(from: Point, to: Point, button: MouseButton): Promise<void> {
    await this.runner.run("xdotool", [
      "mousemove",
      "--sync",
      `${from.x}`,
      `${from.y}`,
      "mousedown",
      XDOTOOL_BUTTON[button],
      "mousemove",
      "--sync",
      `${to.x}`,
      `${to.y}`,
      "mouseup",
      XDOTOOL_BUTTON[button],
    ]);
  }

  async type(text: string): Promise<void> {
    await this.runner.run(
      "xdotool",
      ["type", "--clearmodifiers", "--file", "-"],
      text,
    );
  }

  async key(combo: string): Promise<void> {
    await this.runner.run("xdotool", [
      "key",
      "--clearmodifiers",
      parseKeyCombo(combo).join("+"),
    ]);
  }

  async scroll(
    direction: ScrollDirection,
    amount: number,
    at?: Point,
  ): Promise<void> {
    const move = at ? ["mousemove", "--sync", `${at.x}`, `${at.y}`] : [];
    await this.runner.run("xdotool", [
      ...move,
      "click",
      "--repeat",
      `${amount}`,
      WHEEL_BUTTON[direction],
    ]);
  }

  async cursorPosition(): Promise<Point> {
    const stdout = await this.runner.run("xdotool", [
      "getmouselocation",
      "--shell",
    ]);
    const text = stdout.toString("utf8");
    const x = Number(/^X=(-?\d+)$/m.exec(text)?.[1]);
    const y = Number(/^Y=(-?\d+)$/m.exec(text)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "Could not read the pointer position from xdotool.",
      );
    }
    return { x, y };
  }
}

/** macOS mouse control; text and keys go through System Events instead. */
function macBackend(runner: CommandRunner): ComputerBackend {
  return {
    platform: "darwin",

    async capture(): Promise<Buffer> {
      const file = path.join(os.tmpdir(), `tnt-screen-${Date.now()}.png`);
      try {
        await runner.run("screencapture", ["-x", "-t", "png", file]);
        return fs.readFileSync(file);
      } finally {
        fs.rmSync(file, { force: true });
      }
    },

    async move(point: Point): Promise<void> {
      await runner.run("cliclick", [`m:${point.x},${point.y}`]);
    },

    async click(
      point: Point,
      button: MouseButton,
      count: number,
    ): Promise<void> {
      if (button !== "left") {
        const verb = button === "right" ? "rc" : "mc";
        await runner.run(
          "cliclick",
          Array.from({ length: count }, () => `${verb}:${point.x},${point.y}`),
        );
        return;
      }
      const verb = count >= 3 ? "tc" : count === 2 ? "dc" : "c";
      await runner.run("cliclick", [`${verb}:${point.x},${point.y}`]);
    },

    async drag(from: Point, to: Point, button: MouseButton): Promise<void> {
      if (button !== "left") {
        throw new TntError(
          TntErrorReason.Unspecified,
          "macOS dragging supports the left button only.",
        );
      }
      await runner.run("cliclick", [
        `dd:${from.x},${from.y}`,
        `dm:${to.x},${to.y}`,
        `du:${to.x},${to.y}`,
      ]);
    },

    async type(text: string): Promise<void> {
      await runner.run("osascript", [
        "-e",
        `tell application "System Events" to keystroke ${JSON.stringify(text)}`,
      ]);
    },

    async key(combo: string): Promise<void> {
      const tokens = parseKeyCombo(combo);
      const modifierNames: Record<string, string> = {
        ctrl: "control down",
        control: "control down",
        alt: "option down",
        shift: "shift down",
        super: "command down",
        meta: "command down",
        cmd: "command down",
      };
      const key = tokens.at(-1) ?? "";
      const modifiers = tokens
        .slice(0, -1)
        .map((token) => modifierNames[token] ?? `${token} down`);
      const using =
        modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
      const statement =
        key.length === 1
          ? `keystroke ${JSON.stringify(key)}${using}`
          : `key code ${macKeyCode(key)}${using}`;
      await runner.run("osascript", [
        "-e",
        `tell application "System Events" to ${statement}`,
      ]);
    },

    async scroll(
      _direction: ScrollDirection,
      _amount: number,
      _at?: Point,
    ): Promise<void> {
      throw new TntError(
        TntErrorReason.Unspecified,
        "Scrolling is not implemented on macOS; use keypress with page_up or page_down.",
      );
    },

    async cursorPosition(): Promise<Point> {
      throw new TntError(
        TntErrorReason.Unspecified,
        "cursor_position is not available on macOS.",
      );
    },
  };
}

const MAC_KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  escape: 53,
  esc: 53,
  delete: 51,
  backspace: 51,
  home: 115,
  end: 119,
  page_up: 116,
  pageup: 116,
  page_down: 121,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

function macKeyCode(key: string): number {
  const code = MAC_KEY_CODES[key.toLowerCase()];
  if (code === undefined) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Unsupported macOS key "${key}".`,
    );
  }
  return code;
}

export interface DetectOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  hasCommand?: (command: string, env: NodeJS.ProcessEnv) => boolean;
}

export function detectComputerBackend(
  options: DetectOptions = {},
): ComputerBackend {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.runner ?? execRunner;
  const has = options.hasCommand ?? commandExists;

  if (platform === "win32") {
    throw new TntError(
      TntErrorReason.Unspecified,
      "Desktop control is not implemented on Windows yet. Use Browser for browser work, or an MCP desktop server.",
    );
  }

  if (platform === "darwin") {
    if (!has("cliclick", env)) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "Desktop control on macOS needs cliclick for the pointer: brew install cliclick.",
      );
    }
    return macBackend(runner);
  }

  if (platform !== "linux") {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Desktop control is not supported on ${platform}.`,
    );
  }

  if (!has("xdotool", env)) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "Desktop control on Linux needs xdotool for the pointer and keyboard: install xdotool (it works on X11 and on XWayland windows).",
    );
  }
  if (env.DISPLAY === undefined && env.WAYLAND_DISPLAY === undefined) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "No DISPLAY or WAYLAND_DISPLAY is set, so there is no desktop to control.",
    );
  }

  if (env.WAYLAND_DISPLAY && has("grim", env)) {
    return new X11Backend(runner, "grim");
  }
  if (has("import", env)) {
    return new X11Backend(runner, "import");
  }
  throw new TntError(
    TntErrorReason.Unspecified,
    "No screenshot tool found: install grim (Wayland) or ImageMagick's import (X11).",
  );
}
